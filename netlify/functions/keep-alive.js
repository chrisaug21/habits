// Scheduled Netlify function — runs once daily to prevent the Supabase free-tier
// project from pausing due to inactivity. Makes a minimal read against the state
// table (a single row) using the Supabase REST API via native fetch.
//
// Schedule is configured in netlify.toml under [functions."keep-alive"].
// SUPABASE_URL and SUPABASE_KEY are read from Netlify environment variables.

exports.handler = async function () {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    console.error('keep-alive: SUPABASE_URL or SUPABASE_KEY is not set');
    return { statusCode: 500 };
  }

  try {
    const res = await fetch(`${url}/rest/v1/state?id=eq.1&select=id`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });

    if (!res.ok) {
      console.error(`keep-alive: Supabase returned ${res.status} ${res.statusText}`);
      return { statusCode: 500 };
    }

    console.log('keep-alive: Supabase pinged successfully');
    return { statusCode: 200 };
  } catch (err) {
    console.error('keep-alive: fetch failed', err);
    return { statusCode: 500 };
  }
};
