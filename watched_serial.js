(() => {
    "use strict";

    const CONFIG = {
        concurrency: 10,
        maxRetries: 5,
        retryDelay: 800,
        timeout: 20000,
        fileName: "Filmweb_watched_serial.csv"
    };

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function formatDate(dateNumber) {
        const dateStr = dateNumber?.toString();

        if (!dateStr || dateStr.length < 8) {
            return "";
        }

        return (
            dateStr.substring(0, 4) +
            "-" +
            dateStr.substring(4, 6) +
            "-" +
            dateStr.substring(6, 8)
        );
    }

    function csvEscape(value) {
        if (value === null || value === undefined) {
            return "";
        }

        const text = String(value);

        if (
            text.includes(",") ||
            text.includes('"') ||
            text.includes("\n") ||
            text.includes("\r")
        ) {
            return `"${text.replace(/"/g, '""')}"`;
        }

        return text;
    }

    function xhrRequest(url) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.open("GET", url, true);
            xhr.withCredentials = true;
            xhr.timeout = CONFIG.timeout;

            xhr.setRequestHeader("X-Locale", "pl");

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (error) {
                        reject(
                            Object.assign(
                                new Error("Nieprawidłowy JSON"),
                                {
                                    status: xhr.status
                                }
                            )
                        );
                    }

                    return;
                }

                reject(
                    Object.assign(
                        new Error(`HTTP ${xhr.status}`),
                        {
                            status: xhr.status
                        }
                    )
                );
            };

            xhr.onerror = () => {
                reject(
                    new Error("Błąd sieci")
                );
            };

            xhr.ontimeout = () => {
                reject(
                    new Error("Timeout")
                );
            };

            xhr.send();
        });
    }

    async function fetchApi(endpoint) {
        const url =
            `https://www.filmweb.pl/api/v1/${endpoint}`;

        let lastError;

        for (
            let attempt = 1;
            attempt <= CONFIG.maxRetries;
            attempt++
        ) {
            try {
                return await xhrRequest(url);
            } catch (error) {
                lastError = error;

                console.warn(
                    `⚠️ ${endpoint} | próba ${attempt}/${CONFIG.maxRetries} |`,
                    error.message
                );

                if (attempt === CONFIG.maxRetries) {
                    break;
                }

                let wait;

                if (
                    error.status === 429 ||
                    error.status === 403
                ) {
                    wait = 3000 * attempt;

                    console.warn(
                        `Filmweb ogranicza zapytania. Czekam ${wait / 1000}s.`
                    );
                } else {
                    wait =
                        CONFIG.retryDelay * attempt;
                }

                await sleep(wait);
            }
        }

        throw lastError;
    }

    async function getAllVotes() {
        const allVotes = [];

        console.log(
            "Pobieram listę seriali..."
        );

        /*
         * SERIAL
         */
        let page = 1;

        while (true) {
            console.log(
                `Seriale: strona ${page}`
            );

            const data =
                await fetchApi(
                    `logged/vote/title/serial?page=${page}`
                );

            if (!Array.isArray(data)) {
                throw new Error(
                    `Nieprawidłowa odpowiedź dla serial?page=${page}`
                );
            }

            if (data.length === 0) {
                break;
            }

            allVotes.push(...data);

            console.log(
                `Łącznie znaleziono: ${allVotes.length}`
            );

            page++;
        }

        /*
         * TVSHOW
         */
        page = 1;

        console.log("");
        console.log(
            "Pobieram listę programów / TV Show..."
        );

        while (true) {
            console.log(
                `TV Show: strona ${page}`
            );

            const data =
                await fetchApi(
                    `logged/vote/title/tvshow?page=${page}`
                );

            if (!Array.isArray(data)) {
                throw new Error(
                    `Nieprawidłowa odpowiedź dla tvshow?page=${page}`
                );
            }

            if (data.length === 0) {
                break;
            }

            allVotes.push(...data);

            console.log(
                `Łącznie znaleziono: ${allVotes.length}`
            );

            page++;
        }

        return allVotes;
    }

    async function getSerialData(
        vote,
        index,
        total
    ) {
        const id = vote?.entity;

        if (!id) {
            console.warn(
                `Brak ID dla elementu ${index + 1}`
            );

            return null;
        }

        /*
         * /info i /rating pobierane jednocześnie
         */
        const [
            descriptionData,
            ratingData
        ] = await Promise.all([
            fetchApi(
                `title/${id}/info`
            ),

            fetchApi(
                `film/${id}/rating`
            )
        ]);

        return {
            serialId: id,

            polishTitle:
                descriptionData?.title ?? "",

            originalTitle:
                descriptionData?.originalTitle ?? "",

            year:
                descriptionData?.year ?? "",

            fullRating:
                ratingData?.rate ?? "",

            voteCount:
                ratingData?.count ?? "",

            voteDate:
                formatDate(vote?.viewDate),

            userRating:
                Number(vote?.rate) > 0
                    ? vote.rate
                    : "",

            favorite:
                vote?.favorite
                    ? "tak"
                    : "nie"
        };
    }

    async function getAllRates() {
        const allVotes =
            await getAllVotes();

        const total =
            allVotes.length;

        const allData =
            new Array(total);

        let nextIndex = 0;
        let completed = 0;
        let failed = 0;

        console.log("");
        console.log(
            `Znaleziono łącznie ${total} seriali / programów.`
        );

        console.log(
            `Uruchamiam ${CONFIG.concurrency} równoległych procesów...`
        );

        console.log("");

        async function worker() {
            while (true) {
                const index =
                    nextIndex++;

                if (index >= total) {
                    return;
                }

                const vote =
                    allVotes[index];

                try {
                    const serial =
                        await getSerialData(
                            vote,
                            index,
                            total
                        );

                    allData[index] =
                        serial;

                    completed++;

                    const title =
                        serial?.polishTitle ||
                        serial?.originalTitle ||
                        serial?.serialId ||
                        "?";

                    console.log(
                        `✅ ${completed + failed}/${total} | ${title}`
                    );
                } catch (error) {
                    failed++;

                    const id =
                        vote?.entity ?? "?";

                    console.error(
                        `❌ ${completed + failed}/${total} | ID ${id}`,
                        error
                    );

                    /*
                     * Jeśli Filmweb nie zwróci szczegółów,
                     * zachowujemy przynajmniej dane użytkownika.
                     */
                    allData[index] = {
                        serialId: id,

                        polishTitle: "",

                        originalTitle: "",

                        year: "",

                        fullRating: "",

                        voteCount: "",

                        voteDate:
                            formatDate(
                                vote?.viewDate
                            ),

                        userRating:
                            Number(vote?.rate) > 0
                                ? vote.rate
                                : "",

                        favorite:
                            vote?.favorite
                                ? "tak"
                                : "nie"
                    };
                }
            }
        }

        const workers = [];

        for (
            let i = 0;
            i < CONFIG.concurrency;
            i++
        ) {
            workers.push(
                worker()
            );
        }

        await Promise.all(
            workers
        );

        console.log("");
        console.log(
            `Pobrano poprawnie: ${completed}`
        );

        console.log(
            `Problemy: ${failed}`
        );

        return allData.filter(Boolean);
    }

    function arrayToCsv(data) {
        if (
            !Array.isArray(data) ||
            data.length === 0
        ) {
            return "";
        }

        const columns = [
            "serialId",
            "polishTitle",
            "originalTitle",
            "year",
            "fullRating",
            "voteCount",
            "voteDate",
            "userRating",
            "favorite"
        ];

        const lines = [];

        lines.push(
            columns
                .map(csvEscape)
                .join(",")
        );

        for (const row of data) {
            lines.push(
                columns
                    .map(
                        column =>
                            csvEscape(
                                row[column]
                            )
                    )
                    .join(",")
            );
        }

        return (
            "\uFEFF" +
            lines.join("\r\n")
        );
    }

    function downloadCsv(
        filename,
        csvText
    ) {
        const blob =
            new Blob(
                [csvText],
                {
                    type:
                        "text/csv;charset=utf-8"
                }
            );

        const url =
            URL.createObjectURL(blob);

        const a =
            document.createElement("a");

        a.href = url;
        a.download = filename;
        a.style.display = "none";

        document.body.appendChild(a);

        a.click();

        a.remove();

        setTimeout(
            () =>
                URL.revokeObjectURL(url),
            2000
        );
    }

    async function main() {
        const startTime =
            performance.now();

        try {
            console.log(
                "===================================="
            );

            console.log(
                "FILMWEB → CSV SERIALE FAST"
            );

            console.log(
                "===================================="
            );

            console.log(
                `Równoległe pozycje: ${CONFIG.concurrency}`
            );

            console.log("");

            const allRates =
                await getAllRates();

            if (
                !allRates.length
            ) {
                console.warn(
                    "Brak danych do zapisania."
                );

                return;
            }

            console.log("");
            console.log(
                "Tworzę CSV..."
            );

            const csv =
                arrayToCsv(
                    allRates
                );

            downloadCsv(
                CONFIG.fileName,
                csv
            );

            const elapsed =
                Math.round(
                    (
                        performance.now() -
                        startTime
                    ) / 1000
                );

            console.log("");
            console.log(
                "===================================="
            );

            console.log(
                "✅ GOTOWE"
            );

            console.log(
                `Pozycji: ${allRates.length}`
            );

            console.log(
                `Czas: ${elapsed} s`
            );

            console.log(
                `Plik: ${CONFIG.fileName}`
            );

            console.log(
                "===================================="
            );
        } catch (error) {
            console.error(
                "❌ SKRYPT ZATRZYMANY",
                error
            );
        }
    }

    main();
})();
