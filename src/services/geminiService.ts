import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface Transaction {
  data: string;
  descricao: string;
  valor: number;
}

export type LayoutType = 'COM_LEIAUTE' | 'SEM_LEIAUTE';

export async function extractTransactionsFromPdf(base64Pdf: string, layoutType: LayoutType = 'COM_LEIAUTE'): Promise<Transaction[]> {
  if (!base64Pdf) {
    throw new Error("O arquivo PDF está vazio ou não pôde ser lido.");
  }

  const model = "gemini-3-flash-preview";
  
  const layoutInstruction = layoutType === 'SEM_LEIAUTE' 
    ? "Este documento NÃO possui um formato de tabela claro. O texto pode estar desorganizado, em parágrafos ou colunas desalinhadas. Sua tarefa CRÍTICA é: 1. Ignorar cabeçalhos e rodapés irrelevantes. 2. Identificar cada transação individual procurando por padrões de DATA, DESCRIÇÃO e VALOR. 3. Reconstruir a lista de transações de forma cronológica e estruturada, garantindo que nenhum dado seja perdido mesmo que o texto original esteja 'sujo' ou mal formatado."
    : "Este documento possui um formato de extrato bancário padrão com tabelas ou colunas bem definidas.";

  const prompt = `
    ${layoutInstruction}
    Extraia todas as transações deste extrato bancário de forma impecável e organizada.
    Para cada transação, identifique:
    - data: A data da transação (formato DD/MM/AAAA).
    - descricao: A descrição ou histórico da transação (em LETRAS MAIÚSCULAS).
    - valor: O valor numérico da transação. Use sinal NEGATIVO (-) para débitos/saídas e sinal POSITIVO (+) para créditos/entradas. Retorne apenas o número (ex: -150.50 ou 2000.00).
    
    IMPORTANTE: 
    1. Certifique-se de que o sinal do valor esteja correto de acordo com a natureza da transação (débito ou crédito).
    2. Retorne apenas um array JSON de objetos com as chaves: data, descricao, valor.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "application/pdf",
                data: base64Pdf,
              },
            },
          ],
        },
      ],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              data: { type: Type.STRING },
              descricao: { type: Type.STRING },
              valor: { type: Type.NUMBER },
            },
            required: ["data", "descricao", "valor"],
          },
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("Nenhuma resposta da IA");
    
    return JSON.parse(text);
  } catch (error) {
    console.error("Erro ao extrair transações do PDF:", error);
    throw error;
  }
}

export async function extractTransactionsFromImage(base64Image: string, mimeType: string, layoutType: LayoutType = 'COM_LEIAUTE'): Promise<Transaction[]> {
  if (!base64Image) {
    throw new Error("A imagem está vazia ou não pôde ser lido.");
  }

  const model = "gemini-3-flash-preview";
  
  const layoutInstruction = layoutType === 'SEM_LEIAUTE' 
    ? "Este documento NÃO possui um formato de tabela claro. O texto pode estar desorganizado, em parágrafos ou colunas desalinhadas. Sua tarefa CRÍTICA é: 1. Ignorar cabeçalhos e rodapés irrelevantes. 2. Identificar cada transação individual procurando por padrões de DATA, DESCRIÇÃO e VALOR. 3. Reconstruir a lista de transações de forma cronológica e estruturada, garantindo que nenhum dado seja perdido mesmo que o texto original esteja 'sujo' ou mal formatado."
    : "Este documento possui um formato de extrato bancário padrão com tabelas ou colunas bem definidas.";

  const prompt = `
    ${layoutInstruction}
    Extraia todas as transações desta imagem de extrato bancário de forma impecável e organizada.
    Para cada transação, identifique:
    - data: A data da transação (formato DD/MM/AAAA).
    - descricao: A descrição ou histórico da transação (em LETRAS MAIÚSCULAS).
    - valor: O valor numérico da transação. Use sinal NEGATIVO (-) para débitos/saídas e sinal POSITIVO (+) para créditos/entradas. Retorne apenas o número (ex: -150.50 ou 2000.00).
    
    IMPORTANTE: 
    1. Certifique-se de que o sinal do valor esteja correto de acordo com a natureza da transação (débito ou crédito).
    2. Retorne apenas um array JSON de objetos com as chaves: data, descricao, valor.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              data: { type: Type.STRING },
              descricao: { type: Type.STRING },
              valor: { type: Type.NUMBER },
            },
            required: ["data", "descricao", "valor"],
          },
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("Nenhuma resposta da IA");
    
    return JSON.parse(text);
  } catch (error) {
    console.error("Erro ao extrair transações da imagem:", error);
    throw error;
  }
}

export async function extractTransactionsFromText(text: string, layoutType: LayoutType = 'COM_LEIAUTE'): Promise<Transaction[]> {
  if (!text) {
    throw new Error("O texto está vazio.");
  }

  const model = "gemini-3-flash-preview";
  
  const layoutInstruction = layoutType === 'SEM_LEIAUTE' 
    ? "Este documento NÃO possui um formato de tabela claro. O texto pode estar desorganizado, em parágrafos ou colunas desalinhadas. Sua tarefa CRÍTICA é: 1. Ignorar cabeçalhos e rodapés irrelevantes. 2. Identificar cada transação individual procurando por padrões de DATA, DESCRIÇÃO e VALOR. 3. Reconstruir a lista de transações de forma cronológica e estruturada, garantindo que nenhum dado seja perdido mesmo que o texto original esteja 'sujo' ou mal formatado."
    : "Este documento possui um formato de extrato bancário padrão com tabelas ou colunas bem definidas.";

  const prompt = `
    ${layoutInstruction}
    Extraia todas as transações deste texto de extrato bancário de forma impecável e organizada.
    Para cada transação, identifique:
    - data: A data da transação (formato DD/MM/AAAA).
    - descricao: A descrição ou histórico da transação (em LETRAS MAIÚSCULAS).
    - valor: O valor numérico da transação. Use sinal NEGATIVO (-) para débitos/saídas e sinal POSITIVO (+) para créditos/entradas. Retorne apenas o número (ex: -150.50 ou 2000.00).
    
    IMPORTANTE: 
    1. Certifique-se de que o sinal do valor esteja correto de acordo com a natureza da transação (débito ou crédito).
    2. Retorne apenas um array JSON de objetos com as chaves: data, descricao, valor.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            { text: `TEXTO DO EXTRATO:\n${text}` },
          ],
        },
      ],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              data: { type: Type.STRING },
              descricao: { type: Type.STRING },
              valor: { type: Type.NUMBER },
            },
            required: ["data", "descricao", "valor"],
          },
        },
      },
    });

    const responseText = response.text;
    if (!responseText) throw new Error("Nenhuma resposta da IA");
    
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Erro ao extrair transações do texto:", error);
    throw error;
  }
}
