(() => {
    "use strict";

    const CONFIG = {
        concurrency: 10,
        maxRetries: 5,
        retryDelay: 800,
        timeout: 20000,
        fileName: "Filmweb_watchlist_film.csv"
    };

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    async function getWatchlistIds() {
        console.log(
            "Pobieram listę filmów z watchlisty..."
        );

        const data =
            await fetchApi(
                "logged/want2see?entityName=film"
            );

        if (!Array.isArray(data)) {
            throw new Error(
                "Filmweb zwrócił nieprawidłową listę watchlisty."
            );
        }

        const ids =
            data
                .filter(
                    entry =>
                        Array.isArray(entry) &&
                        entry[1] > 0
                )
                .map(
                    entry => entry[0]
                );

        console.log(
            `Znaleziono ${ids.length} filmów na watchliście.`
        );

        return ids;
    }

    async function getMovieData(id) {
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
            movieId: id,

            polishTitle:
                descriptionData?.title ?? "",

            originalTitle:
                descriptionData?.originalTitle ?? "",

            year:
                descriptionData?.year ?? "",

            fullRating:
                ratingData?.rate ?? "",

            voteCount:
                ratingData?.count ?? ""
        };
    }

    async function getAllRates() {
        const allSavedIds =
            await getWatchlistIds();

        const total =
            allSavedIds.length;

        const allData =
            new Array(total);

        let nextIndex = 0;
        let completed = 0;
        let failed = 0;

        console.log("");
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

                const id =
                    allSavedIds[index];

                try {
                    const movie =
                        await getMovieData(id);

                    allData[index] =
                        movie;

                    completed++;

                    const title =
                        movie?.polishTitle ||
                        movie?.originalTitle ||
                        id;

                    console.log(
                        `✅ ${completed + failed}/${total} | ${title}`
                    );
                } catch (error) {
                    failed++;

                    console.error(
                        `❌ ${completed + failed}/${total} | ID ${id}`,
                        error
                    );

                    allData[index] = {
                        movieId: id,
                        polishTitle: "",
                        originalTitle: "",
                        year: "",
                        fullRating: "",
                        voteCount: ""
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
            "movieId",
            "polishTitle",
            "originalTitle",
            "year",
            "fullRating",
            "voteCount"
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
                "FILMWEB WATCHLIST → CSV FAST"
            );

            console.log(
                "===================================="
            );

            console.log(
                `Równoległe filmy: ${CONFIG.concurrency}`
            );

            console.log("");

            const allRates =
                await getAllRates();

            if (
                !allRates.length
            ) {
                console.warn(
                    "Brak filmów na watchliście."
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
                `Filmów: ${allRates.length}`
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
