const dotenv = require('dotenv');
dotenv.config();

/**
 * Required environment variables:
 *   GEMINI_API_KEY  — Gemini API key (required for AI analysis + fact-check synthesis)
 *
 * Optional search API keys (for higher-quality results; falls back to Wikipedia + DDG if absent):
 *   TAVILY_API_KEY  — Tavily search API (https://tavily.com, free tier available)
 *   SERPER_API_KEY  — Serper.dev Google Search API (https://serper.dev, free tier available)
 *
 * On Render: set these under Environment → Add Environment Variable.
 */

/**
 * Clean HTML entities and tags from strings.
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x60;/g, '`')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Query Tavily search API (best option — has free tier).
 */
async function searchTavily(query) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      num_results: 3,
      include_answer: true
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Tavily API failed: Status ${response.status} - ${body.substring(0, 200)}`);
  }
  const data = await response.json();
  if (!data.results || data.results.length === 0) throw new Error('Tavily returned 0 results.');

  return data.results.map(r => ({
    title: r.title || 'Untitled Source',
    url: r.url,
    snippet: r.content || r.raw_content || ''
  }));
}

/**
 * Query Serper.dev (Google Search API, has a free tier).
 */
async function searchSerper(query) {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query, num: 3 })
  });

  if (!response.ok) throw new Error(`Serper API failed: Status ${response.status}`);
  const data = await response.json();
  if (!data.organic || data.organic.length === 0) throw new Error('Serper returned 0 results.');

  return data.organic.map(r => ({
    title: r.title || 'Untitled Source',
    url: r.link,
    snippet: r.snippet || ''
  }));
}

/**
 * DuckDuckGo Instant Answer API — official, no scraping, no auth needed.
 * Returns abstract text from Wikipedia/Wikidata.
 * Good for general fact claims, not for recency-sensitive stats.
 */
async function searchDDGInstant(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'AgoraDebateApp/1.0',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) throw new Error(`DDG Instant Answer API failed: ${response.status}`);

  const data = await response.json();

  const results = [];

  // Main abstract (Wikipedia/Wikidata)
  if (data.Abstract && data.Abstract.trim()) {
    results.push({
      title: data.Heading || data.AbstractSource || 'DuckDuckGo Instant Answer',
      url: data.AbstractURL || 'https://duckduckgo.com',
      snippet: cleanText(data.Abstract).substring(0, 500)
    });
  }

  // Related topics
  if (data.RelatedTopics && data.RelatedTopics.length > 0) {
    for (const topic of data.RelatedTopics.slice(0, 3)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] || 'Related',
          url: topic.FirstURL,
          snippet: cleanText(topic.Text).substring(0, 300)
        });
      }
      if (results.length >= 3) break;
    }
  }

  if (results.length === 0) {
    throw new Error('DDG Instant Answer returned no useful results for this query.');
  }

  return results;
}

/**
 * Relevance score: how many meaningful words from the query appear in the result title/snippet.
 * Used to filter out obviously wrong Wikipedia articles (e.g. "Jizya" for a divorce query).
 */
function relevanceScore(query, title, snippet) {
  const stopWords = new Set(['the','a','an','of','in','at','is','are','was','were','and','or',
    'for','to','by','that','this','it','its','not','do','does','did','be','been',
    'have','has','had','with','from','as','on','but','so','if','than','then',
    'what','who','how','why','when','where','which','will','would','could','should',
    'claim','verify','percent','statistics','data','study','research','sources']);

  const queryWords = query.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  if (queryWords.length === 0) return 1; // no meaningful words to compare — accept

  const combined = (title + ' ' + snippet).toLowerCase();
  const matches = queryWords.filter(w => combined.includes(w));
  return matches.length / queryWords.length;
}

/**
 * Wikipedia search API — completely free, no auth, returns article summaries.
 * Very reliable for factual claims about people, events, organizations.
 */
async function searchWikipedia(query) {
  // Step 1: search — ask for more candidates so we can filter irrelevant ones
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`;

  const searchResp = await fetch(searchUrl, {
    headers: { 'User-Agent': 'AgoraDebateApp/1.0 (fact-checking)' }
  });
  if (!searchResp.ok) throw new Error(`Wikipedia search failed: ${searchResp.status}`);

  const searchData = await searchResp.json();
  const pages = searchData?.query?.search;
  if (!pages || pages.length === 0) throw new Error('Wikipedia found no matching articles.');

  // Step 2: fetch summaries and filter by relevance
  const results = [];
  for (const page of pages) {
    if (results.length >= 2) break;
    try {
      await new Promise(res => setTimeout(res, 200)); // avoid rate-limit
      const titleEncoded = encodeURIComponent(page.title.replace(/ /g, '_'));
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${titleEncoded}`;
      const summaryResp = await fetch(summaryUrl, {
        headers: { 'User-Agent': 'AgoraDebateApp/1.0' }
      });

      if (summaryResp.ok) {
        const summary = await summaryResp.json();
        if (summary.extract) {
          // Filter out articles with zero keyword overlap with the query
          const score = relevanceScore(query, summary.title || page.title, summary.extract);
          if (score === 0) {
            console.log(`[Search] Dropping irrelevant Wikipedia result: "${page.title}" (score=0 for query: "${query}")`);
            continue;
          }
          results.push({
            title: summary.title || page.title,
            url: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${titleEncoded}`,
            snippet: cleanText(summary.extract).substring(0, 500)
          });
        }
      }
    } catch (e) {
      // continue to next page
    }
  }

  // Also add a DDG instant answer for context
  try {
    const instant = await searchDDGInstant(query);
    if (instant.length > 0) {
      // Only include if relevant
      const ddgScore = relevanceScore(query, instant[0].title, instant[0].snippet);
      if (ddgScore > 0) results.push(instant[0]);
    }
  } catch (e) { /* ignore */ }

  if (results.length === 0) throw new Error('Wikipedia search returned no relevant results for this query.');

  return results.slice(0, 3);
}



/**
 * Main search interface.
 * Priority: Tavily (paid, best) → Serper (paid, good) → Wikipedia + DDG Instant (free, reliable)
 *
 * Wikipedia + DDG Instant is the free-tier fallback that actually works.
 */
async function searchWeb(query) {
  console.log(`[Search] Querying: "${query}"`);

  if (process.env.TAVILY_API_KEY) {
    try {
      console.log('[Search] Trying Tavily...');
      return await searchTavily(query);
    } catch (err) {
      console.warn('[Search] Tavily failed:', err.message);
    }
  }

  if (process.env.SERPER_API_KEY) {
    try {
      console.log('[Search] Trying Serper...');
      return await searchSerper(query);
    } catch (err) {
      console.warn('[Search] Serper failed:', err.message);
    }
  }

  // Free fallback: Wikipedia REST API + DDG Instant Answer
  console.log('[Search] Using free fallback: Wikipedia + DDG Instant Answer...');

  // Try Wikipedia with full query first
  try {
    return await searchWikipedia(query);
  } catch (wikiErr) {
    console.warn('[Search] Wikipedia (full query) failed:', wikiErr.message);

    // Simplify the query to 2-4 key words for a second Wikipedia attempt
    // Strips numbers, percentages, years, and short stop-words
    const simplifiedQuery = query
      .replace(/\b\d{4}\b/g, '')        // remove years
      .replace(/\b\d+(\.\d+)?%?\b/g, '') // remove numbers/percentages
      .replace(/\b(the|a|an|of|in|at|is|are|was|were|and|or|for|to|by|study|data|statistics|percent|per|more|less|than|that|this|they|their|it)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 4)
      .join(' ');

    if (simplifiedQuery && simplifiedQuery !== query) {
      console.log(`[Search] Retrying Wikipedia with simplified query: "${simplifiedQuery}"`);
      try {
        // Wait a moment before retrying (back-off for 429)
        await new Promise(res => setTimeout(res, 1000));
        return await searchWikipedia(simplifiedQuery);
      } catch (wikiErr2) {
        console.warn('[Search] Wikipedia (simplified) failed:', wikiErr2.message);
      }
    }
  }

  // Last resort: DDG Instant Answer only
  try {
    console.log('[Search] Trying DDG Instant Answer as last resort...');
    return await searchDDGInstant(query);
  } catch (ddgErr) {
    // Log full error including the underlying cause (e.g. network failures on Render)
    console.error('[Search] DDG Instant Answer also failed.');
    console.error('[Search] Error message:', ddgErr.message);
    console.error('[Search] Error cause:', ddgErr.cause);   // Node fetch sets .cause for network errors
    console.error('[Search] Full error:', ddgErr);

    // Graceful fallback — return empty results so verifyClaim can still
    // run using the AI's own general knowledge (no external data needed for
    // well-known facts like "water is transparent" or wrong birth years).
    console.warn('[Search] All sources failed. Proceeding with AI-only verification (no external sources).');
    return [];
  }
}

module.exports = { searchWeb };

