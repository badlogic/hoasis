import * as L from "leaflet";
import { PropertyValueMap, html, nothing, render } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { BaseElement, dom, renderError } from "../app.js";
import { pageContainerStyle, pageContentStyle } from "../utils/styles.js";
import { searchIcon } from "../utils/icons.js";
import { repeat } from "lit-html/directives/repeat.js";
import moment from "moment";
import "chartjs-adapter-moment";
import { Chart, registerables } from "chart.js";
Chart.register(...registerables);
L.Icon.Default.imagePath = "/images/";

const dateString = (date: Date) =>
    date.getFullYear() + "-" + (date.getMonth() + 1).toString().padStart(2, "0") + "-" + (date.getDate() + 1).toString().padStart(2, "0");

interface GeocodingResult {
    lat: string;
    lon: string;
    display_name: string;
}

interface SpartacusResult {
    timestamps: string[];
    features: {
        properties: {
            parameters: {
                TN: {
                    name: string;
                    unit: string;
                    data: number[];
                };
                TX: {
                    name: string;
                    unit: string;
                    data: number[];
                };
            };
        };
    }[];
}

const createChart = (
    canvas: HTMLCanvasElement,
    labels: string[],
    datasets: {
        label: string;
        data: Array<number | null>;
        borderColor?: string;
        fill?: boolean;
    }[],
    dateFormat = "YYYY-MM-DD",
    clicked = (index: number) => {}
) => {
    datasets.forEach((dataset: any) => {
        dataset.pointRadius = 0;
        if (!dataset.borderWidth) dataset.borderWidth = 1;
    });
    if ((canvas as any).__chart) {
        const chart: Chart<"line", number[], unknown> = (canvas as any).__chart;
        chart.data.labels = labels;
        chart.data.datasets = datasets as any;
        (chart.options as any).scales.x.time.displayFormats.day = dateFormat;
        chart.update();
        return;
    }

    const chartOptions = {
        animation: false, // Disable animations
        scales: {
            x: {
                type: "time",
                adapters: {
                    date: moment,
                },
                grid: { display: false },
                time: {
                    unit: "day",
                    displayFormats: {
                        day: dateFormat,
                    },
                },
                title: {
                    display: true,
                    text: "Date",
                },
            },
            y: {
                beginAtZero: true,
                grid: { display: true, color: "#ccc2" },
                title: {
                    text: "Temp",
                    display: true,
                },
            },
        },
        plugins: {
            legend: {
                labels: {
                    boxWidth: 30, // Makes the legend's color box narrower
                    boxHeight: 1,
                    // Other styling options here
                },
            },
        },
        onClick: function (event: any, elements: any[]) {
            if (elements.length > 0) {
                clicked(elements[0].index);
            }
        },
    };
    const chart = new Chart(canvas, {
        type: "line",
        data: {
            labels,
            datasets,
        },
        options: chartOptions as any,
    });
    (canvas as any).__chart = chart;
};

@customElement("main-page")
export class MainPage extends BaseElement {
    @state()
    isLoading = false;

    @state()
    error?: string;

    @query("#result")
    result!: HTMLDivElement;

    @query("#address")
    address!: HTMLInputElement;

    @query("#chart")
    chart!: HTMLCanvasElement;

    @query("#startDate")
    startDateInput!: HTMLInputElement;

    @query("#endDate")
    endDateInput!: HTMLInputElement;

    @query("#stackYears")
    stackYears!: HTMLInputElement;

    @query("#firstLastYear")
    firstLastYear!: HTMLInputElement;

    @query("#minTemp")
    minTemp!: HTMLInputElement;

    @query("#maxTemp")
    maxTemp!: HTMLInputElement;

    @state()
    searchResults: GeocodingResult[] = [];

    startDate = new Date(new Date().getFullYear() - 2, 0, 1);
    endDate = new Date();

    map!: L.Map;
    marker?: L.Marker<any>;
    lat = 47.65439560092274;
    lng = 13.502197265625002;
    data?: SpartacusResult;

    protected createRenderRoot(): Element | ShadowRoot {
        return this;
    }

    protected firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
        super.firstUpdated(_changedProperties);
        this.map = L.map("map").setView([this.lat, this.lng], 7);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(this.map);
        this.map.on("click", async (event) => {
            this.lat = event.latlng.lat;
            this.lng = event.latlng.lng;
            this.setMarker();
            this.loadData();
        });
        this.setMarker();
        this.loadData();
    }

    async loadData() {
        this.error = "";

        if (this.startDateInput.value.length == 0 || this.endDateInput.value.length == 0) return;

        try {
            this.isLoading = true;
            const startDate = encodeURIComponent(this.startDateInput.value + "T00:00:00.000Z");
            const endDate = encodeURIComponent(this.endDateInput.value + "T00:00:00.000Z");
            const latLong = encodeURIComponent(this.lat + "," + this.lng);
            const response = await fetch(
                `https://dataset.api.hub.geosphere.at/v1/timeseries/historical/spartacus-v2-1d-1km?parameters=TN&parameters=TX&output_format=geojson&start=${startDate}&end=${endDate}&lat_lon=${latLong}`
            );
            if (!response.ok) throw new Error(await response.text());
            this.data = (await response.json()) as SpartacusResult;
            this.renderCharts();
        } catch (e) {
            this.error = "Whoopsies, da hat etwas nicht funktioniert";
            console.error(e);
        } finally {
            this.isLoading = false;
        }
    }

    async setMarker() {
        this.map.setView({ lat: this.lat, lng: this.lng });
        if (this.marker) this.marker.remove();
        this.marker = L.marker([this.lat, this.lng]).addTo(this.map);
        this.error = "";
    }

    async renderCharts() {
        if (!this.data) return;

        const dates = this.data.timestamps;
        const minTemp = this.data.features[0].properties.parameters.TN.data;
        const maxTemp = this.data.features[0].properties.parameters.TX.data;

        if (this.stackYears.checked) {
            // Initialize a map to hold yearly data
            const yearlyData: {
                [year: string]: {
                    minTemps: Array<number | null>;
                    maxTemps: Array<number | null>;
                };
            } = {};

            // Initialize yearly data with 365 null values for each year present in the data
            dates.forEach((date) => {
                const year = moment(date).format("YYYY");
                if (!yearlyData[year]) {
                    yearlyData[year] = { minTemps: Array(365).fill(null), maxTemps: Array(365).fill(null) };
                }
            });

            // Populate the yearly data with temperatures
            dates.forEach((date, index) => {
                const year = moment(date).format("YYYY");
                const dayOfYear = moment(date).dayOfYear() - 1; // Adjust for 0-index
                yearlyData[year].minTemps[dayOfYear] = minTemp[index];
                yearlyData[year].maxTemps[dayOfYear] = maxTemp[index];
            });

            const datasets: {
                label: string;
                data: Array<number | null>;
                borderColor?: string;
                borderWidth?: number;
                fill?: boolean;
            }[] = [];
            const years = Object.keys(yearlyData).sort(); // Ensure oldest years first
            const baseOpacity = 1 / years.length; // Base opacity for the most recent year

            years.forEach((year, index) => {
                let opacity = (1 - baseOpacity * (years.length - index)) * 0.6 + 0.4; // Decreasing opacity for older years
                if (index == years.length - 1) opacity = 1;
                const isFirstOrLast = index == 0 || index == years.length - 1;
                if (this.firstLastYear.checked && !isFirstOrLast) return;
                if (this.minTemp.checked) {
                    datasets.push({
                        label: `Min Temp ${year}`,
                        data: yearlyData[year].minTemps,
                        borderColor: index == years.length - 1 ? `rgba(54, 100, 235, 1)` : `rgba(54, 162, 235, ${opacity})`, // Nicer Blue
                        borderWidth: index == years.length - 1 ? 2 : 1,
                        fill: false,
                    });
                }
            });

            years.forEach((year, index) => {
                let opacity = (1 - baseOpacity * (years.length - index)) * 0.6 + 0.4; // Decreasing opacity for older years
                if (index == years.length - 1) opacity = 1;
                const isFirstOrLast = index == 0 || index == years.length - 1;
                if (this.firstLastYear.checked && !isFirstOrLast) return;
                if (this.maxTemp.checked) {
                    datasets.push({
                        label: `Max Temp ${year}`,
                        data: yearlyData[year].maxTemps,
                        borderColor: index == years.length - 1 ? "rgba(255, 50, 50, 1)" : `rgba(255, 99, 132, ${opacity})`, // Nicer Red
                        borderWidth: index == years.length - 1 ? 2 : 1,
                        fill: false,
                    });
                }
            });

            // Generate labels for the x-axis representing each day of a non-leap year
            const labels = Array.from({ length: 365 }, (_, i) => moment("0000-01-01").add(i, "days").format("MMM D"));

            createChart(this.chart, labels, datasets, "DD-MM");
        } else {
            const datasets = [];
            if (this.minTemp.checked) datasets.push({ label: "Min. Temp", data: minTemp, borderColor: "rgba(54, 162, 235, 1)", fill: false });
            if (this.maxTemp.checked) datasets.push({ label: "Max. Temp", data: maxTemp, borderColor: "rgba(255, 99, 132, 1)", fill: false });

            createChart(this.chart, dates, datasets, "YYYY-MM-DD");
        }
    }

    async search() {
        try {
            const address = this.address.value.trim();
            const response = await fetch("/search?q=" + encodeURIComponent(address));
            if (!response.ok) throw new Error();
            this.searchResults = ((await response.json()) as GeocodingResult[]).slice(0, 3);
        } catch (e) {
            this.error = "Whoopsies, da hat etwas nicht funktioniert";
            console.log(e);
        } finally {
            this.isLoading = false;
        }
    }

    async selectResult(result: GeocodingResult) {
        this.lat = parseFloat(result.lat);
        this.lng = parseFloat(result.lon);
        this.setMarker();
        this.loadData();
    }

    render() {
        return html`<div class="${pageContainerStyle} items-center gap-4">
            <div class="${pageContentStyle} gap-4 px-4">
                <theme-toggle class="ml-auto mt-4"></theme-toggle>
                <h1 class="text-center -mt-4">Hoaß is'</h1>
                ${this.error ? renderError(this.error) : ""}
                <div class="text-center text-sm">
                    Visualisiere die Temperatur an deinem Ort über die letzten Jahre.<br />
                    Addresse eingeben oder Ort manuell in der Karte suchen und anklicken.
                </div>
                <div class="flex w-full border border-divider rounded-lg px-4 py-2">
                    <input
                        id="address"
                        class="flex-grow outline-none bg-transparent"
                        placeholder="Addresse ..."
                        @keydown=${(ev: KeyboardEvent) => {
                            if (ev.key == "Enter") this.search();
                        }}
                    />
                    <button class="" @click=${() => this.search()}><i class="icon w-6 h-6 fill-blue-400">${searchIcon}</i></button>
                </div>
                <div id="searchResults" class="flex flex-col gap-2">
                    ${repeat(
                        this.searchResults,
                        (result) =>
                            html`<button
                                class="px-4 py-2 border border-blue-400 text-blue-400 line-clamp-1 rounded-md"
                                @click=${() => this.selectResult(result)}
                            >
                                ${result.display_name}
                            </button>`
                    )}
                </div>
                <div id="map" class="h-[30vh] rounded-md"></div>
            </div>
            <div
                class="flex flex-col gap-2 justify-center items-center mt-4 p-4 bg-[#efefef] dark:bg-transparent dark:border dark:border-divider rounded"
            >
                <div class="flex gap-2 items-center">
                    <input
                        id="startDate"
                        type="date"
                        class="border border-divider p-1 rounded text-[#000]"
                        value=${dateString(this.startDate)}
                        @change=${() => this.loadData()}
                    />
                    <span>bis</span>
                    <input
                        id="endDate"
                        type="date"
                        class="border border-divider p-1 rounded text-[#000]"
                        value=${dateString(this.endDate)}
                        @change=${() => this.loadData()}
                    />
                </div>
                <label class="flex items-center gap-1"
                    ><input id="stackYears" type="checkbox" checked @change=${() => this.renderCharts()} /> Jahre übereinander legen</label
                >
                <label class="flex items-center gap-1"
                    ><input id="firstLastYear" type="checkbox" checked @change=${() => this.renderCharts()} /> Nur erstes und letztes Jahr</label
                >
                <div class="flex gap-2">
                    <label class="flex items-center gap-1"
                        ><input id="minTemp" type="checkbox" checked @change=${() => this.renderCharts()} /> Min. Temperatur</label
                    >
                    <label class="flex items-center gap-1"
                        ><input id="maxTemp" type="checkbox" checked @change=${() => this.renderCharts()} /> Max. Temperatur</label
                    >
                </div>
                ${this.isLoading ? html`<loading-spinner></loading-spinner>` : nothing}
            </div>
            <a href="https://data.hub.geosphere.at/dataset/spartacus-v2-1d-1km" class="text-blue-400 text-center"
                >Meteorologische Daten von GeoSphere Austria<br />Täglich aktualisiert</a
            >
            <canvas id="chart" class="w-full flex-grow px-4" style="height: 40vh"></canvas>
            <span class="text-xs text-center text-fg-muted mb-4"
                >Mit Spucke und Tixo gebaut von <a href="https://twitter.com/badlogicgames" class="text-blue-400">Mario Zechner</a><br />Es werden
                keine Daten gesammelt, nicht einmal deine IP Adresse</span
            >
        </div>`;
    }
}
