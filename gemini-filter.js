// gemini-filter.js - AI-powered post filtering using Gemini API

class GeminiPostFilter {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.model = 'gemini-1.5-flash';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  /**
   * Classify a post using Gemini AI
   * Returns { isJobPosting: boolean, confidence: number, reason: string }
   */
  async classifyPost(postContent, filterType = 'paid_jobs') {
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    try {
      const prompt = this.buildPrompt(postContent, filterType);
      const response = await fetch(
        `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 100,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return this.parseResponse(text, filterType);
    } catch (error) {
      console.error('Gemini filter error:', error);
      throw error;
    }
  }

  /**
   * Batch classify multiple posts (more efficient)
   */
  async classifyBatch(posts, filterType = 'paid_jobs') {
    const results = [];
    const batchSize = 5; // Process 5 at a time to avoid rate limits

    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);
      const batchPromises = batch.map(post =>
        this.classifyPost(post.content, filterType)
          .then(result => ({ post, result }))
          .catch(err => ({ post, result: { isMatch: false, confidence: 0, error: err.message } }))
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add small delay between batches to avoid rate limiting
      if (i + batchSize < posts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  buildPrompt(content, filterType) {
    const prompts = {
      paid_jobs: `You are a classifier. Analyze this Facebook post and determine if it's a JOB POSTING that offers PAID work.
      
Post content:
"${content}"

Respond with ONLY a JSON object (no markdown, no extra text):
{"isMatch": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}

isMatch: true if this is a PAID job posting, false otherwise
confidence: how confident you are (0-1)
reason: one sentence explanation`,

      volunteer: `You are a classifier. Analyze this Facebook post and determine if it's asking for VOLUNTEER work or offering UNPAID opportunities.
      
Post content:
"${content}"

Respond with ONLY a JSON object (no markdown, no extra text):
{"isMatch": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}

isMatch: true if this is about volunteer/unpaid work, false otherwise
confidence: how confident you are (0-1)
reason: one sentence explanation`,

      freelance: `You are a classifier. Analyze this Facebook post and determine if it's a FREELANCE or CONTRACT work opportunity.
      
Post content:
"${content}"

Respond with ONLY a JSON object (no markdown, no extra text):
{"isMatch": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}

isMatch: true if this is a freelance/contract work posting, false otherwise
confidence: how confident you are (0-1)
reason: one sentence explanation`,

      internship: `You are a classifier. Analyze this Facebook post and determine if it's an INTERNSHIP opportunity.
      
Post content:
"${content}"

Respond with ONLY a JSON object (no markdown, no extra text):
{"isMatch": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}

isMatch: true if this is an internship opportunity, false otherwise
confidence: how confident you are (0-1)
reason: one sentence explanation`,

      custom: `You are a classifier. Analyze this Facebook post.
      
Post content:
"${content}"

Respond with ONLY a JSON object (no markdown, no extra text):
{"isMatch": true/false, "confidence": 0.0-1.0, "reason": "brief explanation", "category": "job/volunteer/other"}`,
    };

    return prompts[filterType] || prompts.paid_jobs;
  }

  parseResponse(text, filterType) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('No JSON found in response:', text);
        return { isMatch: false, confidence: 0, reason: 'Parse error' };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isMatch: Boolean(parsed.isMatch),
        confidence: Number(parsed.confidence) || 0,
        reason: String(parsed.reason || ''),
        category: parsed.category || filterType,
      };
    } catch (error) {
      console.error('Failed to parse Gemini response:', text, error);
      return { isMatch: false, confidence: 0, reason: 'Parse error' };
    }
  }

  /**
   * Filter posts by AI classification
   */
  async filterPosts(posts, filterType = 'paid_jobs', minConfidence = 0.7) {
    if (!posts.length) return [];

    const classified = await this.classifyBatch(posts, filterType);
    return classified
      .filter(({ result }) => result.isMatch && result.confidence >= minConfidence)
      .map(({ post, result }) => ({
        ...post,
        aiFilter: result,
      }));
  }
}

// Export for use in popup.js
if (typeof window !== 'undefined') {
  window.GeminiPostFilter = GeminiPostFilter;
}
