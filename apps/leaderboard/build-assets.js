import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(appDir, "src/assets");
const out = path.join(appDir, "src/assets_bundled.js");

function collectFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (/\.(js|css|webp)$/.test(entry.name)) {
      results.push(path.relative(assetsDir, full).replace(/\\/g, "/"));
    }
  }
  return results;
}

function isBareSpecifier(specifier) {
  return !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("#");
}

function tokenize(source) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i + 2);
      if (i < 0) break;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === "'" || char === "\"") {
      const quote = char;
      let value = "";
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          value += source[i + 1] || "";
          i += 2;
        } else if (source[i] === quote) {
          i += 1;
          break;
        } else {
          value += source[i];
          i += 1;
        }
      }
      tokens.push({ type: "string", value });
      continue;
    }
    if (char === "`") {
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i] === "`") {
          i += 1;
          break;
        } else i += 1;
      }
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = i;
      i += 1;
      while (i < source.length && /[\w$]/.test(source[i])) i += 1;
      tokens.push({ type: "word", value: source.slice(start, i) });
      continue;
    }
    tokens.push({ type: "punct", value: char });
    i += 1;
  }
  return tokens;
}

function consumeBracedClause(tokens, index) {
  if (tokens[index]?.value !== "{") return -1;
  let depth = 0;
  for (let i = index; i < tokens.length; i += 1) {
    if (tokens[i].value === "{") depth += 1;
    if (tokens[i].value === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function staticSpecifier(tokens, index, keyword) {
  let cursor = index + 1;
  if (keyword === "import" && tokens[cursor]?.value === "(") {
    return tokens[cursor + 1]?.type === "string" && tokens[cursor + 2]?.value === ")"
      ? tokens[cursor + 1].value
      : "";
  }
  if (tokens[cursor]?.type === "string") return keyword === "import" ? tokens[cursor].value : "";
  if (keyword === "import" && tokens[cursor]?.value === "type") cursor += 1;
  if (tokens[cursor]?.value === "*") {
    cursor += 1;
    if (tokens[cursor]?.value === "as") cursor += 2;
  } else if (tokens[cursor]?.value === "{") {
    cursor = consumeBracedClause(tokens, cursor);
  } else if (tokens[cursor]?.type === "word") {
    cursor += 1;
    if (tokens[cursor]?.value === ",") cursor += 1;
    if (tokens[cursor]?.value === "*") {
      cursor += 1;
      if (tokens[cursor]?.value === "as") cursor += 2;
    } else if (tokens[cursor]?.value === "{") {
      cursor = consumeBracedClause(tokens, cursor);
    }
  }
  return tokens[cursor]?.value === "from" && tokens[cursor + 1]?.type === "string"
    ? tokens[cursor + 1].value
    : "";
}

function importSpecifiers(source) {
  const tokens = tokenize(source);
  const specifiers = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "word") continue;
    if (tokens[i].value === "import" || tokens[i].value === "export") {
      const specifier = staticSpecifier(tokens, i, tokens[i].value);
      if (specifier) specifiers.push(specifier);
    }
  }
  return specifiers;
}

export function hasBareImport(source) {
  return importSpecifiers(source).some(isBareSpecifier);
}

// Relative imports BETWEEN assets stay external (the browser loads each
// asset as its own module), but relative imports INSIDE an inlined package
// (e.g. shared dist modules importing their siblings) must be bundled — the
// browser cannot resolve them against /assets/.
const externalAssetModulesPlugin = {
  name: "external-asset-modules",
  setup(build) {
    build.onResolve({ filter: /^(?:\.{1,2}\/|\/)/ }, ({ path: importPath, kind, importer }) => {
      if (kind === "entry-point") return undefined;
      if (importer && !importer.startsWith(assetsDir + path.sep)) return undefined;
      return { path: importPath, external: true };
    });
  },
};

async function assetContent(rel) {
  const source = fs.readFileSync(path.join(assetsDir, rel), "utf8");
  if (path.extname(rel) === ".js" && hasBareImport(source)) {
    const result = await bundle({
      entryPoints: [path.join(assetsDir, rel)],
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
      plugins: [externalAssetModulesPlugin],
    });
    return result.outputFiles[0].text;
  }
  return source;
}

export async function writeAssetBundle() {
  const files = collectFiles(assetsDir);
  let outSrc = "// Auto-generated. Do not edit. Asset files inlined as strings.\n";
  outSrc += "export const ASSETS = {\n";
  for (const rel of files) {
    const ext = path.extname(rel);
    const isBinary = ext === ".webp";
    const content = isBinary
      ? fs.readFileSync(path.join(assetsDir, rel), "base64")
      : await assetContent(rel);
    const webPath = "/assets/" + rel;
    outSrc += `  ${JSON.stringify(webPath)}: [${JSON.stringify(content)}, ${JSON.stringify(ext)}, ${JSON.stringify(isBinary ? "base64" : "utf8")}],\n`;
  }
  outSrc += "};\n";
  fs.writeFileSync(out, outSrc);
  console.log("bundled", files.length, "assets into", out, "(", outSrc.length, "bytes )");
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await writeAssetBundle();
}
