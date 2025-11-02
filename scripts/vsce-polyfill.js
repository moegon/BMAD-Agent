if (typeof globalThis.File !== 'function') {
  const { Blob } = globalThis;
  class PolyfillFile extends Blob {
    constructor(bits, name, options = {}) {
      super(bits, options);
      if (typeof name !== 'string') {
        throw new TypeError('File name must be a string');
      }
      this.name = name;
      this.lastModified = typeof options.lastModified === 'number' ? options.lastModified : Date.now();
      this.webkitRelativePath = options.webkitRelativePath || '';
    }
  }

  Object.defineProperty(PolyfillFile.prototype, Symbol.toStringTag, {
    value: 'File'
  });

  globalThis.File = PolyfillFile;
}
