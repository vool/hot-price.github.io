import { LitElement, PropertyValueMap, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { map } from "lit-html/directives/map.js";
import { globalStyles } from "../styles";
import { i18n } from "../i18n";
import { Item, Price, UNITS } from "../model/models";
import { BUDGET_BRANDS, STORE_KEYS, stores } from "../model/stores";
import alasql from "alasql";
import { Checkbox } from "./checkbox";

@customElement("hp-items-filter")
export class ItemsFilter extends LitElement {
    static styles = [globalStyles];

    @property()
    items: Item[] = [];

    @property()
    lookup: Record<string, Item> = {};

    @property()
    itemsChanged: (filteredItems: Item[], queryTokens: string[]) => void = () => {};

    @query("#query")
    queryElement?: HTMLInputElement;

    @query("#minPrice")
    minPriceElement?: HTMLInputElement;

    @query("#maxPrice")
    maxPriceElement?: HTMLInputElement;

    @query("#discountBrandsOnly")
    discountBrandsOnlyElement?: Checkbox;

    @query("#organicOnly")
    organicOnlyElement?: Checkbox;

    @state()
    isAlaSQLQuery = false;

    @state()
    sqlError = "";

    selectedStores = [...STORE_KEYS];

    protected firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
        this.queryElement!.value = "milch";
        this.filter();
    }

    protected render() {
        return html`
            <div class="bg-[#E7E5E4] rounded-xl border p-4 flex flex-col gap-2 w-full max-w-[800px]">
                <input @input="${this.filter}" id="query" class="w-full rounded-full px-4 py-1" placeholder="${i18n("search placeholder")}" />
                ${!this.isAlaSQLQuery
                    ? html` <div class="flex justify-center gap-2 flex-wrap text-sm">
                              <hp-checkbox @change="${this.toggleAllStores}" checked="true">${i18n("All")}</hp-checkbox>
                              ${map(
                                  STORE_KEYS,
                                  (store) =>
                                      html`<hp-checkbox @change="${() => this.toggleStore(store)}" bgColor="${stores[store].color}" checked="true"
                                          >${stores[store].name}</hp-checkbox
                                      >`
                              )}
                          </div>
                          <div class="flex justify-center gap-2 flex-wrap">
                              <hp-checkbox id="discountBrandsOnly" @change="${this.filter}" class="text-sm"
                                  >${i18n("Discount store brands only")}</hp-checkbox
                              >
                              <hp-checkbox id="organicOnly" @change="${this.filter}" class="text-sm">${i18n("Organic only")}</hp-checkbox>
                              <div class="rounded-full border bg-white px-2 py-1 text-sm flex-wrap">
                                  <span>${i18n("Price") + " " + i18n("currency symbol")}</span>
                                  <input @input="${this.filter}" id="minPrice" type="number" min="0" max="10000" value="0" />
                                  <span>-</span>
                                  <input @input="${this.filter}" id="maxPrice" type="number" min="0" max="10000" value="1000" />
                              </div>
                          </div>`
                    : this.sqlError
                    ? html`<div>${this.sqlError}</div>`
                    : nothing}
            </div>
        `;
    }

    toggleAllStores() {}

    toggleStore(store: string) {
        if (this.selectedStores.includes(store)) {
            this.selectedStores = this.selectedStores.filter((other) => other != store);
        } else {
            this.selectedStores = [...this.selectedStores, store];
        }
        this.filter();
    }

    filter() {
        const query = this.queryElement?.value.trim() ?? "";
        if (query.startsWith("!")) {
            this.isAlaSQLQuery = true;
            this.sqlError = "";
            try {
                const hits = queryItemsAlasql(query, this.items);
                this.itemsChanged(hits, []);
                console.log(hits.length);
            } catch (e) {
                if (e instanceof Error) this.sqlError = e.message;
                else this.sqlError = "Unknown alaSQL error";
                this.itemsChanged([], []);
            }
        } else {
            const getNumber = (value: string, def: number) => {
                try {
                    return Number.parseFloat(value);
                } catch (e) {
                    return def;
                }
            };
            const minPrice = this.minPriceElement ? getNumber(this.minPriceElement.value, 0) : 0;
            const maxPrice = this.maxPriceElement ? getNumber(this.maxPriceElement.value, 1000) : 1000;
            const organicOnly = this.organicOnlyElement?.checked ?? false;
            const discountBrandsOnly = this.discountBrandsOnlyElement?.checked ?? false;
            const selectedStores = this.selectedStores;

            const filteredItems = this.items.filter((item) => {
                if (!selectedStores.includes(item.store)) return;
                if (discountBrandsOnly && !BUDGET_BRANDS.some((budgetBrand) => item.name.toLowerCase().indexOf(budgetBrand) >= 0)) return false;
                if (organicOnly && !item.organic) return false;
                if (minPrice > item.price) return false;
                if (maxPrice < item.price) return false;
                return true;
            });

            this.isAlaSQLQuery = false;
            const hits = queryItems(query, filteredItems, false);
            this.itemsChanged(hits.items, hits.queryTokens);
            console.log(hits.items.length);
        }
    }
}

function queryItemsAlasql(query: string, items: Item[]): Item[] {
    alasql.fn.hasPriceChange = (priceHistory: Price[], date: string, endDate: string) => {
        if (!endDate) return priceHistory.some((price) => price.date == date);
        else return priceHistory.some((price) => price.date >= date && price.date <= endDate);
    };

    alasql.fn.hasPriceChangeLike = (priceHistory: Price[], date: string) => {
        return priceHistory.some((price) => price.date.indexOf(date) >= 0);
    };

    alasql.fn.daysBetween = (date1: string, date2: string) => {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        const diffInMs = Math.abs((d2 as any) - (d1 as any));
        const days = Math.ceil(diffInMs / (1000 * 60 * 60 * 24));
        return days;
    };

    alasql.fn.priceOn = function (priceHistory: Price[], date: string) {
        return this.priceOn(priceHistory, date);
    };

    alasql.fn.unitPriceOn = function (priceHistory: Price[], date: string) {
        return this.unitPriceOn(priceHistory, date);
    };

    alasql.fn.percentageChangeSince = function (priceHistory: Price[], date: string) {
        const firstPrice = this.priceOn(priceHistory, date);
        const price = priceHistory[0].price;
        return ((price - firstPrice) / firstPrice) * 100;
    };

    query = query.substring(1);
    return alasql("select * from ? where " + query, [items]);
}

function queryItems(query: string, items: Item[], exactWord = false): { items: Item[]; queryTokens: string[] } {
    query = query.trim().replace(",", ".").toLowerCase();
    if (query.length < 3) return { items: [], queryTokens: [] };
    const regex = /([\p{L}&-\.][\p{L}\p{N}&-\.]*)|(>=|<=|=|>|<)|(\d+(\.\d+)?)/gu;
    let tokens: string[] | null = query.match(regex);
    if (!tokens) return { items: [], queryTokens: [] };

    // Find quantity/unit query
    let newTokens = [];
    let unitQueries = [];
    const operators = ["<", "<=", ">", ">=", "="];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        let unit = UNITS[token];
        if (unit && i > 0 && /^\d+(\.\d+)?$/.test(tokens[i - 1])) {
            newTokens.pop();
            let operator = "=";
            if (i > 1 && operators.includes(tokens[i - 2])) {
                newTokens.pop();
                operator = tokens[i - 2];
            }

            unitQueries.push({
                operator,
                quantity: Number.parseFloat(tokens[i - 1]) * unit.factor,
                unit: unit.unit,
            });
        } else {
            newTokens.push(token);
        }
    }
    tokens = newTokens;
    if (!tokens || tokens.length == 0) return { items: [], queryTokens: [] };

    let hits = [];
    for (const item of items) {
        let allFound = true;
        for (let token of tokens) {
            if (token.length === 0) continue;
            let not = false;
            if (token.startsWith("-") && token.length > 1) {
                not = true;
                token = token.substring(1);
            }
            const index = item.search.indexOf(token);
            if ((!not && index < 0) || (not && index >= 0)) {
                allFound = false;
                break;
            }
            if (exactWord) {
                if (index > 0 && item.search.charAt(index - 1) != " " && item.search.charAt(index - 1) != "-") {
                    allFound = false;
                    break;
                }
                if (index + token.length < item.search.length && item.search.charAt(index + token.length) != " ") {
                    allFound = false;
                    break;
                }
            }
        }
        if (allFound) {
            let allUnitsMatched = true;
            for (const query of unitQueries) {
                if (query.unit != item.unit) {
                    allUnitsMatched = false;
                    break;
                }

                if (query.operator == "=" && !(item.quantity == query.quantity)) {
                    allUnitsMatched = false;
                    break;
                }

                if (query.operator == "<" && !(item.quantity < query.quantity)) {
                    allUnitsMatched = false;
                    break;
                }

                if (query.operator == "<=" && !(item.quantity <= query.quantity)) {
                    allUnitsMatched = false;
                    break;
                }

                if (query.operator == ">" && !(item.quantity > query.quantity)) {
                    allUnitsMatched = false;
                    break;
                }

                if (query.operator == ">=" && !(item.quantity >= query.quantity)) {
                    allUnitsMatched = false;
                    break;
                }
            }
            if (allUnitsMatched) hits.push(item);
        }
    }
    return { items: hits, queryTokens: tokens.filter((token) => !token.startsWith("-")) };
}
