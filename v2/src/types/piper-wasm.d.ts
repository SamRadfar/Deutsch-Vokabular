// Emscripten glue of piper-phonemize + espeak-ng (@diffusionstudio/piper-wasm, MIT).
declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  export interface PiperPhonemizeModule {
    callMain(args: string[]): number;
  }
  export interface PiperPhonemizeOptions {
    /** The .wasm bytes (no fetch by the glue). */
    wasmBinary?: ArrayBuffer;
    /** The .data package (espeak-ng data) bytes (no fetch by the glue). */
    getPreloadedPackage?: (name: string, size: number) => ArrayBuffer;
    instantiateWasm?: (
      imports: WebAssembly.Imports,
      done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) => object;
    print?: (line: string) => void;
    printErr?: (line: string) => void;
    locateFile?: (path: string) => string;
  }
  const createPiperPhonemize: (options?: PiperPhonemizeOptions) => Promise<PiperPhonemizeModule>;
  export default createPiperPhonemize;
}
