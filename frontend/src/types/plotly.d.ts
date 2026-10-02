declare module 'plotly.js-dist-min' {
  const Plotly: {
    newPlot: (element: HTMLElement, data: unknown[], layout?: unknown, config?: unknown) => Promise<unknown>
    react: (element: HTMLElement, data: unknown[], layout?: unknown, config?: unknown) => Promise<unknown>
    purge: (element: HTMLElement) => void
    Plots: { resize: (element: HTMLElement) => Promise<unknown> }
  }
  export default Plotly
}
