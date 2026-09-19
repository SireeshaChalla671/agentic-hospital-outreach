import dotenv from "dotenv";
dotenv.config();

async function main() {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
  );
  const data = await res.json();
  const models = (data as any).models || [];
  for (const m of models) {
    if (m.supportedGenerationMethods?.includes("generateContent")) {
      console.log(m.name, "-", m.displayName);
    }
  }
}

main();