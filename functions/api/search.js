export async function onRequestPost(context) {
  const { request, env } = context;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const { query } = await request.json();
    if (!query || query.length < 2) {
      return new Response(JSON.stringify({ error: 'Query too short' }), { status: 400, headers: corsHeaders });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: corsHeaders });
    }

    // Fetch site index
    const siteUrl = new URL(request.url);
    const indexUrl = `${siteUrl.protocol}//${siteUrl.host}/data/site-index.json`;
    const indexResp = await fetch(indexUrl);
    const siteData = await indexResp.text();

    const prompt = `You are the AI search assistant for Photo & Moto, a Finnish motorsport photography and history website. Answer questions based ONLY on the site data provided below. Answer in the same language the question is asked in (Finnish or English). Be concise and helpful. If the data doesn't contain the answer, say so politely.

SITE DATA:
${siteData}

USER QUESTION: ${query}`;

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.3 }
        })
      }
    );

    const geminiData = await geminiResp.json();
    const answer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 'Valitettavasti en löytänyt vastausta.';

    return new Response(JSON.stringify({ answer }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Search failed' }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
