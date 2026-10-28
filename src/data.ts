/**
 * Fixed dataset supplied to the code as `data`: sales per region and
 * quarter, split by product so the bars can be stacked or coloured by it.
 */
export const salesByRegion = [
  { region: "North", quarter: "Q1", product: "A", total: 25 },
  { region: "North", quarter: "Q1", product: "B", total: 15 },
  { region: "North", quarter: "Q2", product: "A", total: 30 },
  { region: "North", quarter: "Q2", product: "B", total: 25 },
  { region: "South", quarter: "Q1", product: "A", total: 18 },
  { region: "South", quarter: "Q1", product: "B", total: 12 },
  { region: "South", quarter: "Q2", product: "A", total: 20 },
  { region: "South", quarter: "Q2", product: "B", total: 28 },
  { region: "East", quarter: "Q1", product: "A", total: 35 },
  { region: "East", quarter: "Q1", product: "B", total: 25 },
  { region: "East", quarter: "Q2", product: "A", total: 22 },
  { region: "East", quarter: "Q2", product: "B", total: 30 },
];

/** The dataset's field names (keys of the first row), offered as choices in the UI. */
export function dataFields(): string[] {
  return Object.keys(salesByRegion[0] ?? {});
}

export const INITIAL_CODE = `chart(data, { axes: true })
  .flow(
    spread({ by: "quarter", dir: "x", spacing: 40 }),
    spread({ by: "product", dir: "x", spacing: 8 }),
    stack({ by: "region", dir: "y" }),
  )
  .mark(rect({ h: "total", fill: "region" }))
`;
