/** Fixed dataset supplied to the code as `data` (the thesis demo's rows). */
export const salesByRegion = [
  { region: "North", quarter: "Q1", total: 40 },
  { region: "North", quarter: "Q2", total: 55 },
  { region: "South", quarter: "Q1", total: 30 },
  { region: "South", quarter: "Q2", total: 48 },
  { region: "East", quarter: "Q1", total: 60 },
  { region: "East", quarter: "Q2", total: 52 },
];

export const INITIAL_CODE = `chart(data, { axes: true })
  .flow(
    spread({ by: "region", dir: "x", spacing: 40 }),
    spread({ by: "quarter", dir: "x", spacing: 8 }),
  )
  .mark(rect({ h: "total", fill: "#7c8a99" }))
`;
