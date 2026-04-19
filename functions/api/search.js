export async function onRequestPost(context) {
  const { request, env } = context;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const { query, siteData } = await request.json();
    if (!query || query.length < 2) {
      return new Response(JSON.stringify({ error: 'Query too short' }), { status: 400, headers: corsHeaders });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not found in environment' }), { status: 500, headers: corsHeaders });
    }

    // Trim data to stay within token limits
    const trimmedData = siteData ? siteData.substring(0, 50000) : '[]';
    
    const prompt = `You are the AI search assistant for Photo & Moto, a Finnish motorsport photography and history website. Answer questions based ONLY on the site data provided below. Answer in the same language the question is asked in (Finnish or English). Be concise but complete. If the data doesn't contain the answer, say so politely.

SITE DATA:
${trimmedData}

USER QUESTION: ${query}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const geminiResp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.3 }
      })
    });

    const geminiText = await geminiResp.text();
    
    if (!geminiResp.ok) {
      return new Response(JSON.stringify({ error: 'Gemini API error: ' + geminiResp.status + ' - ' + geminiText.substring(0, 200) }), { headers: corsHeaders });
    }

    const geminiData = JSON.parse(geminiText);
    const answer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!answer) {
      return new Response(JSON.stringify({ error: 'No answer from Gemini. Raw: ' + geminiText.substring(0, 200) }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ answer }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Function error: ' + err.message }), { status: 500, headers: corsHeaders });
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
