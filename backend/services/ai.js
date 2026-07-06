const dotenv = require('dotenv');
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-2.5-flash';

/**
 * Helper to call Gemini REST API.
 */
async function callGemini(contents, schema = null, systemInstruction = null) {
  if (!GEMINI_API_KEY) {
    console.warn('[AI Service] GEMINI_API_KEY not configured. Running in Mock Mode.');
    // Handled in calling functions
    throw new Error('MOCK_MODE_TRIGGER');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
  
  const body = {
    contents: contents
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const generationConfig = {};
  if (schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = schema;
  }
  body.generationConfig = generationConfig;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API call failed: Status ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  try {
    const textContent = data.candidates[0].content.parts[0].text;
    if (schema) {
      return JSON.parse(textContent);
    }
    return textContent;
  } catch (err) {
    console.error('Failed to parse Gemini response data:', JSON.stringify(data));
    throw new Error('Invalid Gemini API response structure.');
  }
}

/**
 * Pipeline Step 1: Ingest and parse a new message.
 * Returns classification type, fallacy list, checkable claims, and canonical match.
 */
async function parseMessage(messageText, authorName, topic, existingNodes) {
  // Format existing nodes list for concept matching context
  const nodesContext = existingNodes.map(n => ({
    id: n.id,
    canonical_concept_id: n.canonical_concept_id,
    author: n.author,
    text: n.text,
    type: n.type
  }));

  const systemInstruction = `You are Agora, the AI moderator of a live debate.
Your task is to analyze the incoming message in the context of the ongoing debate topic: "${topic}".
Perform the following analysis:
1. Classify the message into one of these types:
   - "claim": Stating a new proposition, stance, or conceptual argument.
   - "evidence": Citing a fact, statistic, reference, or study to back up a claim.
   - "rebuttal": Countering, disputing, or directly challenging a previous claim.
   - "question": Asking a clarifying or analytical query.
   - "concession": Agreeing with or acknowledging a point made by the other side.
2. Check for common logical fallacies: ad hominem, strawman, false dilemma, slippery slope, appeal to emotion, whataboutism, circular reasoning, hasty generalization, appeal to authority (misused). List any detected fallacies with a brief, clear, and non-shaming explanation. Also include a constructive, fallacy-free "rephrase_suggestion" to help the user express their core argument productively.
3. Extract any verifiable factual or statistical claim made. If the statement is just an opinion, value judgment, or pure logic, set this to null. Keep it short (e.g. "Germany produced 50% of its power from solar in 2023").
4. Canonical Matching: Look at the existing debate nodes. If this message is referencing, repeating, or directly confirming/challenging the exact same underlying fact/claim as an existing node, return that node's canonical_concept_id so we can group them in the Knowledge Graph. If it is a completely new concept, return null.
5. Subtopic Detection: If this message takes the debate noticeably deeper into a specific sub-issue (e.g. the main debate is "remote work vs office" and this message focuses specifically on "childcare and remote work"), set detected_subtopic to true and provide a short subtopic_label (3-6 words). Otherwise set both to false/null.
6. Reply Detection: Look at the existing debate nodes. If this message is most directly responding to, rebutting, or building on a specific previous message, return that node's id as reply_to_node_id. If it is a standalone new point, return null.`;

  const promptText = `
--- DEBATE TOPIC ---
"${topic}"

--- EXISTING DEBATE NODES ---
${JSON.stringify(nodesContext, null, 2)}

--- NEW MESSAGE TO ANALYZE ---
Author: "${authorName}"
Message: "${messageText}"

Analyze this message according to the rules and return the results in the required JSON format.`;

  const contents = [
    {
      parts: [{ text: promptText }]
    }
  ];

  const schema = {
    type: 'OBJECT',
    properties: {
      type: {
        type: 'STRING',
        enum: ['claim', 'evidence', 'rebuttal', 'fallacy', 'question', 'concession']
      },
      fallacies: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING' },
            explanation: { type: 'STRING' },
            rephrase_suggestion: { type: 'STRING' }
          },
          required: ['type', 'explanation', 'rephrase_suggestion']
        }
      },
      extracted_claim: { type: 'STRING', nullable: true },
      canonical_concept_match: { type: 'STRING', nullable: true },
      detected_subtopic: { type: 'BOOLEAN' },
      subtopic_label: { type: 'STRING', nullable: true },
      reply_to_node_id: { type: 'STRING', nullable: true }
    },
    required: ['type', 'fallacies', 'extracted_claim', 'canonical_concept_match', 'detected_subtopic', 'subtopic_label', 'reply_to_node_id']
  };

  try {
    return await callGemini(contents, schema, systemInstruction);
  } catch (err) {
    if (err.message === 'MOCK_MODE_TRIGGER') {
      // Simulate parser logic using keyword triggers
      const lowerText = messageText.toLowerCase();
      let type = 'claim';
      if (lowerText.includes('disagree') || lowerText.includes('rebut') || lowerText.includes('wrong') || lowerText.includes('not true')) {
        type = 'rebuttal';
      } else if (lowerText.includes('source') || lowerText.includes('study') || lowerText.includes('research') || lowerText.includes('data') || lowerText.includes('statistics')) {
        type = 'evidence';
      } else if (lowerText.includes('why') || lowerText.includes('?') || lowerText.includes('how can')) {
        type = 'question';
      } else if (lowerText.includes('concede') || lowerText.includes('agree') || lowerText.includes('fair point') || lowerText.includes('accept')) {
        type = 'concession';
      }

      // Detect fallacy
      const fallacies = [];
      if (lowerText.includes('you ') || lowerText.includes('your ') || lowerText.includes('stupid') || lowerText.includes('idiot') || lowerText.includes('ignorant')) {
        fallacies.push({
          type: 'ad hominem',
          explanation: 'Attacking the person making the argument instead of addressing the core argument itself.',
          rephrase_suggestion: 'I disagree with your point. Let\'s look at the facts instead of focusing on personal aspects.'
        });
      } else if (lowerText.includes('always') || lowerText.includes('never') || lowerText.includes('everyone') || lowerText.includes('nobody')) {
        fallacies.push({
          type: 'hasty generalization',
          explanation: 'Making a sweeping conclusion based on insufficient or selective evidence.',
          rephrase_suggestion: 'In many observed cases, this holds true, though there may be exceptions depending on context.'
        });
      }

      // Claim extraction: look for numbers or statistics
      let extracted_claim = null;
      const numMatch = messageText.match(/\b\d+(\.\d+)?%?\b/);
      if (numMatch) {
        extracted_claim = messageText.trim().length > 120
          ? messageText.trim().substring(0, 120)
          : messageText.trim();
      }

      // Canonical match: look for matching concepts
      let canonical_concept_match = null;
      if (existingNodes.length > 0) {
        const words = lowerText.split(/\s+/).filter(w => w.length > 5);
        for (const node of existingNodes) {
          const nodeText = node.text.toLowerCase();
          if (words.some(w => nodeText.includes(w))) {
            canonical_concept_match = node.canonical_concept_id;
            break;
          }
        }
      }

      // Subtopic detection: heuristic — long message with specific keywords
      const subtopicKeywords = ['specifically', 'particularly', 'in terms of', 'regarding', 'when it comes to', 'focus on', 'especially'];
      const detected_subtopic = lowerText.length > 80 && subtopicKeywords.some(k => lowerText.includes(k));
      const subtopic_label = detected_subtopic ? messageText.split(/[,.!?]/)[0].trim().substring(0, 40) : null;

      // Reply detection: find the most recent node from a different author
      let reply_to_node_id = null;
      if (existingNodes.length > 0) {
        const others = existingNodes.filter(n => n.author !== authorName);
        if (others.length > 0) reply_to_node_id = others[others.length - 1].id;
      }

      return {
        type,
        fallacies,
        extracted_claim,
        canonical_concept_match,
        detected_subtopic,
        subtopic_label,
        reply_to_node_id
      };
    }

    console.error('Error in parseMessage AI Service:', err.message);
    return {
      type: 'claim',
      fallacies: [],
      extracted_claim: null,
      canonical_concept_match: null
    };
  }
}

/**
 * Pipeline Step 2: Synthesize search results to verify a claim.
 */
async function verifyClaim(claim, searchResults) {
  const systemInstruction = `You are a precise, confident fact-checking assistant with broad general knowledge.

Your job is to evaluate whether a claim is true or false, using BOTH:
1. The provided web search results
2. Your own general knowledge and training data

Rules:
- If you know from general knowledge that a claim is factually wrong (e.g. a wrong birth year, wrong statistic, incorrect historical date), return "false" — do NOT return "unverified" just because the search results are incomplete.
- If a claim is false, your explanation MUST include the correct fact (e.g. "Gandhi was actually born on October 2, 1869, not 1988").
- Only use "unverified" for genuinely ambiguous claims where neither you nor the search results can determine truth (e.g. unpublished data, future predictions, purely subjective claims).
- Be direct and specific. Never be vague.

Verdicts:
- "true": Claim is correct and supported.
- "false": Claim is factually wrong. Always state the correct fact in the explanation.
- "partially_true": Claim has a correct core but contains errors or important missing context.
- "unverified": Genuinely impossible to verify from any source (rare — use sparingly).`;

  const promptText = `Claim to fact-check: "${claim}"

Web search results for context:
${JSON.stringify(searchResults, null, 2)}

Use your general knowledge AND the search results. If the claim is false, state the correct fact clearly.`;

  const contents = [
    {
      parts: [{ text: promptText }]
    }
  ];

  const schema = {
    type: 'OBJECT',
    properties: {
      verdict: {
        type: 'STRING',
        enum: ['true', 'false', 'partially_true', 'unverified']
      },
      explanation: { type: 'STRING' }
    },
    required: ['verdict', 'explanation']
  };

  try {
    return await callGemini(contents, schema, systemInstruction);
  } catch (err) {
    if (err.message === 'MOCK_MODE_TRIGGER') {
      const verdicts = ['true', 'false', 'partially_true'];
      const index = Math.floor(Math.random() * verdicts.length);
      const mockVerdict = verdicts[index];
      
      let explanation = '';
      if (mockVerdict === 'true') {
        explanation = 'Search sources confirm that this statistic aligns with published consensus reports.';
      } else if (mockVerdict === 'false') {
        explanation = 'Credible studies show contrary statistics; this claim is contradicted by official findings.';
      } else {
        explanation = 'This statistic is correct, but omission of the general scope makes it partially misleading.';
      }

      return {
        verdict: mockVerdict,
        explanation: `[Mock Verification] ${explanation}`
      };
    }
    console.error('Error in verifyClaim AI Service:', err.message);
    return {
      verdict: 'unverified',
      explanation: 'Failed to verify claim due to an AI processing error.'
    };
  }
}

/**
 * Generate End of Debate Summary.
 */
async function generateSummary(topic, nodes, edges) {
  const systemInstruction = `You are Agora, the AI moderator of this debate.
Generate a structured, professional, and balanced summary of the debate.
Focus on:
1. Key claims that survived fact-checking and which ones were debunked.
2. Areas where logical fallacies clustered (e.g. ad hominems, strawmen).
3. The remaining values-based disagreements that cannot be settled by facts alone.`;

  const promptText = `
Debate Topic: "${topic}"

Debate Nodes:
${JSON.stringify(nodes.map(n => ({ author: n.author, type: n.type, text: n.text, fact_status: n.fact_status, fallacies: n.fallacy_flags })), null, 2)}

Debate Edges:
${JSON.stringify(edges, null, 2)}

Generate a summary of the debate formatted in clear, readable Markdown. Include bullet points.`;

  const contents = [
    {
      parts: [{ text: promptText }]
    }
  ];

  try {
    return await callGemini(contents, null, systemInstruction);
  } catch (err) {
    if (err.message === 'MOCK_MODE_TRIGGER') {
      // Build a beautiful simulated markdown summary
      return `## Agora Debate Analysis Report
**Topic:** *"${topic}"*

### 1. Key Arguments & Claim Status
- **Surviving/Verified Claims:** Claims highlighting empirical data points were confirmed by reference checks and anchored the visual nodes.
- **Debunked/Refuted Claims:** Several statistical assertions were checked against web repositories and flagged as incorrect or missing key factors.

### 2. Moderation Audit (Logical Fallacies)
- **Clusters Detected:** We observed ad-hominem nudges triggered by personal phrasing, and hasty generalizations derived from absolute statements ("always", "everyone").
- **Correction Ratio:** Debaters resolved some of these fallacies by accepting AI suggestions, maintaining constructive standards.

### 3. Stance Summary & Value Disagreements
- Despite fact resolution, disagreement remains centered on the subjective values-based aspects of the motion rather than purely statistical items.
`;
    }
    console.error('Error in generateSummary AI Service:', err.message);
    return `### Debate Summary
Failed to generate summary due to an AI service error.
Error Details: ${err.message}`;
  }
}

module.exports = {
  parseMessage,
  verifyClaim,
  generateSummary
};
