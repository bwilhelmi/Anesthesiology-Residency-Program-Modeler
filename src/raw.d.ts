/**
 * Vite serves any import suffixed with `?raw` as the file's text. Declaring it
 * here keeps `tsc --noEmit` happy without pulling in Node type packages just so
 * a test can read a source file.
 */
declare module "*?raw" {
  const contents: string;
  export default contents;
}
