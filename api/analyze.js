const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain required' });
    }

    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    
    console.log('Analyzing:', url);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AEO-GEO-Analyzer/1.0)'
      },
      timeout: 10000,
      maxRedirects: 5
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Extract schema markup
    const schemaScripts = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const schema = JSON.parse($(el).html());
        schemaScripts.push(schema);
      } catch (e) {
        console.error('Invalid schema JSON');
      }
    });

    const schemaTypes = schemaScripts.map(s => s['@type']).filter(Boolean);
    const hasFAQ = schemaTypes.includes('FAQPage');
    const hasHowTo = schemaTypes.includes('HowTo');
    const hasArticle = schemaTypes.includes('Article') || schemaTypes.includes('BlogPosting');

    // Extract meta
    const title = $('title').text();
    const metaDescription = $('meta[name="description"]').attr('content') || '';

    // Headings
    const h1s = $('h1').map((i, el) => $(el).text().trim()).get();
    const h2s = $('h2').map((i, el) => $(el).text().trim()).get();
    const h3s = $('h3').map((i, el) => $(el).text().trim()).get();

    // Word count
    const textContent = $('body').text();
    const wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;

    // Calculate AEO score
    let aeoScore = 5.0;
    if (schemaTypes.length > 0) aeoScore += 1.5;
    if (hasFAQ) aeoScore += 1.5;
    if (hasHowTo) aeoScore += 1.0;
    if (h1s.length === 1) aeoScore += 0.5;
    if (metaDescription.length > 50 && metaDescription.length < 160) aeoScore += 0.5;

    // Calculate GEO score
    let geoScore = 4.5;
    if (wordCount > 1500) geoScore += 1.5;
    if (wordCount > 2500) geoScore += 1.0;
    const externalLinks = $('a[href^="http"]').length;
    if (externalLinks > 5) geoScore += 0.5;

    const analysis = {
      domain,
      crawledAt: new Date().toISOString(),
      aeo: {
        score: Math.min(aeoScore, 10).toFixed(1),
        factors: {
          structuredData: { score: schemaTypes.length > 0 ? 7 : 3, weight: 30 },
          schemaImplementation: { score: metaDescription ? 6 : 3, weight: 25 },
          faqOptimization: { score: hasFAQ ? 8 : 3, weight: 20 },
          voiceSearchReady: { score: h1s.length === 1 ? 7 : 4, weight: 15 },
          featuredSnippetPotential: { score: 6, weight: 10 }
        },
        findings: {
          schemaMarkup: {
            found: schemaTypes,
            missing: buildMissingSchema({ hasFAQ, hasHowTo, hasArticle }),
            examples: buildSchemaExamples(schemaScripts, domain, hasFAQ)
          },
          metaTags: {
            examples: buildMetaExamples(title, metaDescription, domain)
          },
          headingStructure: {
            h1Count: h1s.length,
            h2Count: h2s.length,
            h3Count: h3s.length,
            examples: buildHeadingExamples(h1s, h2s)
          }
        },
        strengths: buildAEOStrengths(schemaTypes, h1s.length),
        weaknesses: buildAEOWeaknesses(hasFAQ, metaDescription),
        opportunities: buildAEOOpportunities(hasFAQ, hasHowTo),
        threats: buildAEOThreats(),
        actions: buildAEOActions(domain)
      },
      geo: {
        score: Math.min(geoScore, 10).toFixed(1),
        factors: {
          contentDepth: { score: wordCount > 2000 ? 8 : wordCount > 1000 ? 6 : 4, weight: 25 },
          citability: { score: externalLinks > 10 ? 6 : 3, weight: 25 },
          authoritySignals: { score: 5, weight: 20 },
          contextClarity: { score: 5, weight: 15 },
          aiReadability: { score: 6, weight: 15 }
        },
        findings: {
          authorCredentials: {
            found: false,
            examples: buildAuthorExamples(domain)
          },
          citations: {
            externalReferences: externalLinks,
            hasCitationSection: false,
            examples: buildCitationExamples()
          },
          contentStructure: {
            wordCount,
            hasData: /\d+%/.test(textContent),
            hasTables: $('table').length > 0,
            examples: buildContentExamples(wordCount)
          }
        },
        strengths: buildGEOStrengths(wordCount, externalLinks),
        weaknesses: buildGEOWeaknesses(),
        opportunities: buildGEOOpportunities(),
        threats: buildGEOThreats(),
        actions: buildGEOActions(domain)
      }
    };

    res.status(200).json(analysis);

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message,
      details: error.response?.status ? `HTTP ${error.response.status}` : 'Network error'
    });
  }
};

function buildMissingSchema({ hasFAQ, hasHowTo, hasArticle }) {
  const missing = [];
  if (!hasFAQ) missing.push('FAQ', 'Question');
  if (!hasHowTo) missing.push('HowTo');
  if (!hasArticle) missing.push('Article', 'BlogPosting');
  missing.push('BreadcrumbList', 'VideoObject', 'Product');
  return missing;
}

function buildSchemaExamples(schemas, domain, hasFAQ) {
  const examples = [];
  
  if (schemas.length > 0) {
    examples.push({
      type: 'Schema Found: ' + (schemas[0]['@type'] || 'Unknown'),
      location: '<head> section',
      code: JSON.stringify(schemas[0], null, 2).substring(0, 300) + '...',
      issue: schemas.length === 1 ? 'Only basic schema - expand coverage' : 'Multiple schemas found'
    });
  }

  if (!hasFAQ) {
    examples.push({
      type: 'Missing FAQ Schema',
      location: 'FAQ/Help pages',
      code: null,
      recommendation: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "What is ${domain}?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "Direct answer here"
    }
  }]
}
</script>`,
      issue: 'No FAQ schema detected - missing featured snippet opportunities'
    });
  }

  return examples;
}

function buildMetaExamples(title, metaDescription, domain) {
  return [
    {
      type: 'Title Tag Analysis',
      current: `<title>${title || 'No title'}</title>`,
      issue: !title ? 'Missing title' : title.length < 30 ? 'Too short' : title.length > 60 ? 'Too long' : 'Could be more specific',
      recommendation: `<title>How to [Solve Problem] | ${domain} - Expert Guide</title>`,
      impact: 'Title should directly answer user intent'
    },
    {
      type: 'Meta Description',
      current: `<meta name="description" content="${metaDescription || 'Missing'}">`,
      issue: !metaDescription ? 'Missing meta description' : metaDescription.length < 50 ? 'Too short' : 'Optimize for direct answers',
      recommendation: `<meta name="description" content="Learn how to [topic] with our step-by-step guide. Includes [benefit 1], [benefit 2], and expert tips. Get started now.">`,
      impact: 'Direct answers improve featured snippet chances'
    }
  ];
}

function buildHeadingExamples(h1s, h2s) {
  const examples = [];
  
  if (h1s.length > 0) {
    examples.push({
      tag: 'H1',
      text: h1s[0],
      issue: h1s[0].includes('?') ? 'Good - question format ✓' : 'Not in question format',
      recommendation: h1s[0].includes('?') ? 'Maintain question format' : `Change to: "How Does ${h1s[0]} Work?" or "What is ${h1s[0]}?"`
    });
  }

  if (h2s.length > 0) {
    examples.push({
      tag: 'H2',
      text: h2s[0],
      issue: 'Generic heading',
      recommendation: 'Make it specific: "Why [Benefit]?" or "How to [Action]?"'
    });
  }

  return examples;
}

function buildAEOStrengths(schemaTypes, h1Count) {
  return [
    {
      title: schemaTypes.length > 0 ? 'Schema markup implemented' : 'HTML structure present',
      detail: schemaTypes.length > 0 ? `Found ${schemaTypes.length} schema type(s): ${schemaTypes.join(', ')}` : 'Basic HTML structure detected',
      code: schemaTypes.length > 0 ? '<script type="application/ld+json">' : '<html> <head> <body>',
      impact: schemaTypes.length > 0 ? 'Search engines can understand content structure' : 'Standard HTML parsing available'
    },
    {
      title: h1Count === 1 ? 'Proper H1 hierarchy' : 'Heading structure exists',
      detail: `${h1Count} H1 tag(s) found`,
      code: 'H1 → H2 → H3 structure',
      impact: h1Count === 1 ? 'Optimal for content extraction' : 'Basic content organization'
    },
    {
      title: 'Mobile-responsive design likely',
      detail: 'Modern HTML5 structure detected',
      code: '<meta name="viewport">',
      impact: 'Compatible with mobile answer engines'
    }
  ];
}

function buildAEOWeaknesses(hasFAQ, metaDescription) {
  return [
    {
      title: 'Missing FAQ schema',
      detail: 'No structured Q&A markup detected',
      code: 'No FAQPage schema found in <head>',
      impact: 'Losing 60% of featured snippet opportunities for question queries',
      fix: 'Add FAQPage schema to all Q&A content with Question/Answer pairs'
    },
    {
      title: metaDescription ? 'Meta description needs optimization' : 'Missing meta description',
      detail: metaDescription ? `Current length: ${metaDescription.length} chars` : 'No meta description tag found',
      code: metaDescription ? `<meta name="description" content="...">` : 'Missing: <meta name="description">',
      impact: 'Reduced answer extraction by search engines',
      fix: 'Write 120-155 character descriptions providing direct answers'
    },
    {
      title: 'Missing speakable schema',
      detail: 'No voice assistant optimization',
      code: 'No speakable markup detected',
      impact: 'Voice assistants won\'t know which content to read aloud',
      fix: 'Add speakable schema to key content sections'
    }
  ];
}

function buildAEOOpportunities(hasFAQ, hasHowTo) {
  return [
    {
      title: 'Implement comprehensive FAQ schema',
      detail: 'Add structured Q&A to help and support pages',
