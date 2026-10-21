// jose v6 is ESM. Jest 29's CJS VM needs module syntax conversion, as the
// production Lambda bundler does. This executes the real library, not a mock.
const ts = require("typescript");
module.exports = {
  process(source, filename) {
    return {
      code: ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    };
  },
};
