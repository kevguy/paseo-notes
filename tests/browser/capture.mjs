import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, ".validation/browser");
const screenshots = resolve(root, "docs/screenshots");
const bundle = join(output, "bundle.js");
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><meta charset="utf-8"/><title>Notes preview</title><style>html,body,#root{height:100%;margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;

await mkdir(output, { recursive: true });
await mkdir(screenshots, { recursive: true });
await build({
  entryPoints: [resolve(root, "tests/browser/entry.tsx")], outfile: bundle, bundle: true,
  format: "iife", platform: "browser", target: ["es2022"], jsx: "automatic", logLevel: "info",
  alias: { "react-native": "react-native-web" },
  plugins: [{
    name: "synthetic-paseo-sdk",
    setup(builder) {
      builder.onResolve({ filter: /^@getpaseo\/plugin(?:\/client)?$/ }, (args) => ({ path: args.path, namespace: "synthetic-sdk" }));
      builder.onLoad({ filter: /^@getpaseo\/plugin$/, namespace: "synthetic-sdk" }, () => ({
        loader: "js", resolveDir: root, contents: "export function defineSettings(value){return value}",
      }));
      builder.onLoad({ filter: /^@getpaseo\/plugin\/client$/, namespace: "synthetic-sdk" }, () => ({
        loader: "js", resolveDir: root, contents: `import {useCallback,useState} from 'react'; const example='Call Jordan about the Atlas launch\\n\\n- Update the rollout checklist\\n- Pick a time for the demo\\n\\nBring the draft to Friday’s review.'; export function useSettings(){const [content,setContent]=useState(example);const [revision,setRevision]=useState('1');const save=useCallback(async(values)=>{setContent(values.content);setRevision(String(Date.now()));return true},[]);return {status:'ready',values:{content},revision,saving:false,saveError:null,save,reset:async()=>true,reload:async()=>{}}}`,
      }));
    },
  }],
});

const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/bundle.js")) {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(await readFile(bundle));
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  }
});
await new Promise((resolveListen) => server.listen(43873, "127.0.0.1", resolveListen));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:43873");
  const desktopInput = page.getByRole("textbox", { name: "Scratchpad notes" });
  await desktopInput.waitFor();
  await page.screenshot({ path: join(screenshots, "notes-desktop.png") });
  const mobile = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
  await mobile.goto("http://127.0.0.1:43873/?mobile");
  const mobileInput = mobile.getByRole("textbox", { name: "Scratchpad notes" });
  await mobileInput.waitFor();
  await mobile.screenshot({ path: join(screenshots, "notes-mobile.png") });
  await mobileInput.fill("A quick follow-up note");
  await mobile.getByText("Saved on this Paseo host").waitFor({ timeout: 3000 });
  await mobile.getByRole("button", { name: "Clear notes" }).click();
  await mobile.getByRole("button", { name: "Clear it" }).click();
  await mobile.waitForFunction(() => (document.querySelector('[aria-label="Scratchpad notes"]')?.value ?? null) === "");
  await writeFile(join(output, "report.json"), JSON.stringify({ status: "passed", checks: ["autosave", "confirmed clear"], screenshots: ["notes-desktop.png", "notes-mobile.png"], fixture: "fictional Atlas notes" }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}
