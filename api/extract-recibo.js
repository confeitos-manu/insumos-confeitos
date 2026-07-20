// Recebe a foto da nota (base64) do app, chama o Gemini escondendo a chave,
// e devolve os itens já organizados.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido" });
    return;
  }

  const { base64, mediaType } = req.body || {};
  if (!base64 || !mediaType) {
    res.status(400).json({ error: "Faltou a imagem" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY não configurada no servidor" });
    return;
  }

  const prompt =
    "Você lê fotos de notas fiscais de mercado brasileiras e extrai os itens comprados. " +
    "Responda SOMENTE com um JSON válido, sem markdown, sem texto antes ou depois, " +
    'exatamente neste formato: {"loja": string ou null, "data": string ou null, "items": ' +
    '[{"codigo": string ou null, "nome": string, "quantidade": number, "precoUnitario": number, "precoTotal": number}]}. ' +
    "O campo 'codigo' é o código do produto que aparece na coluna 'Código' da nota (geralmente um " +
    "número, pode ter vários dígitos) — copie exatamente como está impresso, sem inventar nem arredondar. " +
    "Se a nota não tiver essa coluna, use null. " +
    "Expanda abreviações de produtos para nomes legíveis e SEMPRE no mesmo padrão de escrita " +
    "para o mesmo produto (ex: 'CHOC PO 500G' vira 'Chocolate em Pó 500g'). Ignore linhas de " +
    "imposto, forma de pagamento, troco e totais gerais — inclua apenas os produtos. Se não " +
    "conseguir ler um campo, use null nesse campo específico.";

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mediaType, data: base64 } },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("Erro do Gemini:", JSON.stringify(data));
      res.status(502).json({ error: data?.error?.message || "Falha ao ler a nota" });
      return;
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p) => p.text && !p.thought);
    const text = textPart ? textPart.text : parts.map((p) => p.text).filter(Boolean).join("");

    if (!text) {
      console.error("Resposta sem texto:", JSON.stringify(data));
      const finishReason = data?.candidates?.[0]?.finishReason;
      res.status(502).json({ error: `Resposta vazia do Gemini (motivo: ${finishReason || "desconhecido"})` });
      return;
    }

    const clean = text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.error("Falha ao parsear JSON:", text);
      res.status(502).json({ error: "A IA não devolveu um JSON válido", detalhe: text.slice(0, 300) });
      return;
    }
    res.status(200).json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao processar a nota: " + String(err && err.message ? err.message : err) });
  }
}
