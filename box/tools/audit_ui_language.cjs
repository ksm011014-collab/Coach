const fs = require("node:fs");
const path = require("node:path");
const { babelParse, traverse } = require("../node_modules/playwright/lib/transform/babelBundle.js");

const files = process.argv.slice(2);
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const ast = babelParse(source, file);
  const strings = [];
  traverse(ast, {
    StringLiteral(nodePath) {
      const node = nodePath.node;
      if (!/[가-힣]/.test(node.value)) return;
      const translated = nodePath.parent.type === "CallExpression" && nodePath.parent.callee.name === "t";
      strings.push({ value: node.value, start: node.start, end: node.end, line: node.loc.start.line, translated });
    },
    TemplateElement(nodePath) {
      const node = nodePath.node;
      if (/[가-힣]/.test(node.value.raw)) strings.push({ template: node.value.raw, start: node.start, end: node.end, line: node.loc.start.line });
    }
  });
  console.log(JSON.stringify({ file: path.normalize(file), strings }));
}
