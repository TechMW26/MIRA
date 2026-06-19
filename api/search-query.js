import { formSearchQuery } from './_searchQuery.js';

export const config = { maxDuration: 15 };

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await formSearchQuery({
      latestMessage: body?.latestMessage,
      context: body?.context,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || 'Could not form search query.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
