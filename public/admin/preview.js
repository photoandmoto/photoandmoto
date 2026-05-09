// Decap CMS custom preview for the articles collection.
//
// Renders the entry in the same shape as the live site's ArticleLayout.astro:
// back-link, meta row (badge + date), title, subtitle, hero image, body,
// sources block, and footer (author + tags). Loaded by /admin/index.html
// after the Decap CMS bundle.
//
// `h` and `CMS` are globals exposed by decap-cms.js. We deliberately use
// vanilla JS (no JSX, no build step) so this file ships as-is.

(function () {
  'use strict';

  // Escape HTML special chars and auto-link URLs.
  // Mirrors renderSources() in src/layouts/ArticleLayout.astro.
  function renderSourcesHtml(text) {
    var escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return escaped.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  }

  // Format an ISO-ish date string as a Finnish localized date. Falls back to
  // the raw string if unparseable.
  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d.valueOf())) return String(dateStr);
    try {
      return d.toLocaleDateString('fi-FI', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch (e) {
      return String(dateStr);
    }
  }

  // Detect which locale we're previewing. Tries (in order): the `language`
  // field on the entry data, the file path (fi/ vs en/ prefix), then
  // defaults to fi. Used to localize chrome labels (back-link, "Lähteet"
  // vs "Sources", "Kirjoittaja:" vs "Author:").
  function detectLang(data, entry) {
    try {
      var lang = data && data.get && data.get('language');
      if (lang === 'fi' || lang === 'en') return lang;
    } catch (e) {}
    try {
      var path = entry && entry.get && (entry.get('path') || entry.get('slug'));
      if (typeof path === 'string') {
        if (path.indexOf('en/') === 0 || path.indexOf('/en/') >= 0) return 'en';
        if (path.indexOf('fi/') === 0 || path.indexOf('/fi/') >= 0) return 'fi';
      }
    } catch (e) {}
    return 'fi';
  }

  var LABELS = {
    fi: { back: '← Takaisin artikkeleihin', author: 'Kirjoittaja: ', sources: 'Lähteet' },
    en: { back: '← Back to articles', author: 'Author: ', sources: 'Sources' },
  };

  // Build a list of SEO health checks from the entry data. Each check:
  //   { status: 'ok' | 'warn' | 'fail', msg: '...', suggestion?: '...' }
  function computeSeoHealth(data) {
    var checks = [];

    var title = String(data.get('title') || '');
    var subtitle = data.get('subtitle');
    var seoDesc = data.get('seo_description');
    var featuredImage = data.get('featured_image');
    var imageCaption = data.get('image_caption');
    var tags = data.get('tags');
    var body = String(data.get('body') || '');

    // Title length: 30-65 ideal
    var tLen = title.length;
    if (tLen === 0) {
      checks.push({ status: 'fail', msg: 'Otsikko puuttuu' });
    } else if (tLen < 30) {
      checks.push({ status: 'warn', msg: 'Otsikko: ' + tLen + ' merkkiä (suositus 30-65, lisää sanoja)' });
    } else if (tLen > 65) {
      checks.push({ status: 'warn', msg: 'Otsikko: ' + tLen + ' merkkiä (suositus 30-65, leikkaa)' });
    } else {
      checks.push({ status: 'ok', msg: 'Otsikko: ' + tLen + ' merkkiä' });
    }

    // SEO description: 120-160 ideal, max 160
    var dLen = seoDesc ? String(seoDesc).length : 0;
    if (dLen === 0) {
      // Suggest first ~155 chars of body (stripped of markdown)
      var bodyText = body.replace(/[#*_`\[\]]/g, '').replace(/\s+/g, ' ').trim();
      var suggest = bodyText.slice(0, 155);
      if (bodyText.length > 155) suggest = suggest.replace(/\s+\S*$/, '') + '…';
      checks.push({
        status: 'warn',
        msg: 'SEO-kuvaus puuttuu (kopioi alta jos sopii)',
        suggestion: suggest || null,
      });
    } else if (dLen > 160) {
      checks.push({ status: 'fail', msg: 'SEO-kuvaus: ' + dLen + ' merkkiä (yli 160, leikkaantuu Googlessa)' });
    } else if (dLen < 120) {
      checks.push({ status: 'warn', msg: 'SEO-kuvaus: ' + dLen + ' merkkiä (suositus 120-160)' });
    } else {
      checks.push({ status: 'ok', msg: 'SEO-kuvaus: ' + dLen + ' merkkiä' });
    }

    // Subtitle (recommended for visual hierarchy)
    if (subtitle && String(subtitle).trim()) {
      checks.push({ status: 'ok', msg: 'Alaotsikko asetettu' });
    } else {
      checks.push({ status: 'warn', msg: 'Alaotsikko puuttuu (suositeltu visuaalisen hierarkian vuoksi)' });
    }

    // Featured image (required for OG/Twitter cards)
    if (featuredImage) {
      checks.push({ status: 'ok', msg: 'Pääkuva asetettu' });
    } else {
      checks.push({ status: 'fail', msg: 'Pääkuva puuttuu (tarvitaan sosiaalisen median jakoihin)' });
    }

    // Image caption (when there is a featured image)
    if (featuredImage && (!imageCaption || !String(imageCaption).trim())) {
      checks.push({ status: 'warn', msg: 'Pääkuvan kuvateksti puuttuu (saavutettavuus + alt-teksti)' });
    } else if (featuredImage) {
      checks.push({ status: 'ok', msg: 'Pääkuvan kuvateksti asetettu' });
    }

    // Tags
    var tagCount = tags && typeof tags.size === 'number' ? tags.size : 0;
    if (tagCount === 0) {
      checks.push({ status: 'fail', msg: 'Avainsanat puuttuvat (lisää 3-5 löydettävyyden parantamiseksi)' });
    } else if (tagCount < 3) {
      checks.push({ status: 'warn', msg: 'Avainsanat: ' + tagCount + ' (suositus 3-5)' });
    } else {
      checks.push({ status: 'ok', msg: 'Avainsanat: ' + tagCount + ' kpl' });
    }

    // Body word count (300+ ideal for SEO)
    var wordCount = body.trim() ? body.trim().split(/\s+/).filter(Boolean).length : 0;
    if (wordCount === 0) {
      checks.push({ status: 'fail', msg: 'Sisältö tyhjä' });
    } else if (wordCount < 100) {
      checks.push({ status: 'fail', msg: 'Sisältö: ' + wordCount + ' sanaa (liian lyhyt SEO:lle, suositus 300+)' });
    } else if (wordCount < 300) {
      checks.push({ status: 'warn', msg: 'Sisältö: ' + wordCount + ' sanaa (suositus 300+)' });
    } else {
      checks.push({ status: 'ok', msg: 'Sisältö: ' + wordCount + ' sanaa' });
    }

    // H2 sections in body (structure for skim-readers + SEO)
    var h2Count = (body.match(/^##\s/gm) || []).length;
    if (h2Count === 0 && wordCount > 200) {
      checks.push({ status: 'warn', msg: 'Ei H2-väliotsikoita (lisää rakenne pidempään tekstiin)' });
    } else if (h2Count >= 2) {
      checks.push({ status: 'ok', msg: 'H2-väliotsikoita: ' + h2Count });
    } else if (h2Count === 1) {
      checks.push({ status: 'warn', msg: 'H2-väliotsikoita: 1 (suositus vähintään 2 jäsentelyyn)' });
    }

    return checks;
  }

  // The articles collection's preview component. Receives `entry`,
  // `widgetFor`, `widgetsFor`, `getAsset` via props.
  function ArticlePreview(props) {
    var data = props.entry && props.entry.get && props.entry.get('data');
    if (!data) return h('div', null, 'Loading…');

    var lang = detectLang(data, props.entry);
    var labels = LABELS[lang] || LABELS.fi;

    var title = data.get('title') || '';
    var subtitle = data.get('subtitle');
    var author = data.get('author') || 'Photo & Moto';
    var dateStr = data.get('date');
    var category = data.get('category') || '';
    var tags = data.get('tags');
    var featuredImage = data.get('featured_image');
    var showHero = data.get('show_hero');
    var imageCaption = data.get('image_caption');
    var sources = data.get('sources');

    // Resolve the hero image to a URL (handles both committed paths and
    // pending uploads via getAsset's blob URL).
    var heroSrc = null;
    if (featuredImage && props.getAsset) {
      try {
        heroSrc = String(props.getAsset(featuredImage));
      } catch (e) {
        heroSrc = null;
      }
    }

    var children = [];

    // SEO health panel — sits above the article preview so issues are visible
    // before scrolling. Updates live as the editor types.
    var seoChecks = computeSeoHealth(data);
    var iconFor = function (s) {
      if (s === 'ok') return '✓';
      if (s === 'fail') return '✕';
      return '⚠';
    };
    var passing = seoChecks.filter(function (c) { return c.status === 'ok'; }).length;
    children.push(
      h(
        'aside',
        { key: 'seo', className: 'seo-health' },
        h(
          'h3',
          { className: 'seo-health__heading' },
          'SEO-terveys ',
          h(
            'span',
            { className: 'seo-health__score' },
            passing + ' / ' + seoChecks.length
          )
        ),
        h(
          'ul',
          { className: 'seo-health__list' },
          seoChecks.map(function (c, i) {
            return h(
              'li',
              { key: 'c-' + i, className: 'seo-check seo-check--' + c.status },
              h('span', { className: 'seo-check__icon' }, iconFor(c.status)),
              h(
                'div',
                { className: 'seo-check__body' },
                h('span', { className: 'seo-check__msg' }, c.msg),
                c.suggestion
                  ? h(
                      'span',
                      { className: 'seo-check__suggestion' },
                      c.suggestion
                    )
                  : null
              )
            );
          })
        )
      )
    );

    children.push(
      h('a', { key: 'back', className: 'back-link' }, labels.back)
    );

    children.push(
      h(
        'div',
        { key: 'meta-top', className: 'article-meta-top' },
        category ? h('span', { key: 'cat', className: 'badge' }, category) : null,
        h('span', { key: 'date', className: 'meta-date' }, formatDate(dateStr))
      )
    );

    children.push(
      h('h1', { key: 'title', className: 'article-title' }, title)
    );

    if (subtitle) {
      children.push(
        h('p', { key: 'sub', className: 'article-subtitle' }, subtitle)
      );
    }

    if (heroSrc && showHero !== false) {
      children.push(
        h(
          'div',
          { key: 'hero', className: 'article-hero' },
          h('img', { key: 'img', src: heroSrc, alt: imageCaption || title }),
          imageCaption
            ? h('figcaption', { key: 'cap' }, imageCaption)
            : null
        )
      );
    }

    children.push(
      h(
        'div',
        { key: 'body', className: 'article-body' },
        props.widgetFor('body')
      )
    );

    if (sources) {
      children.push(
        h(
          'aside',
          { key: 'sources', className: 'article-sources' },
          h(
            'h3',
            { key: 'h', className: 'article-sources__heading' },
            labels.sources
          ),
          h('div', {
            key: 'b',
            className: 'article-sources__body',
            dangerouslySetInnerHTML: { __html: renderSourcesHtml(sources) },
          })
        )
      );
    }

    var tagList = null;
    if (tags && typeof tags.size === 'number' && tags.size > 0) {
      var tagArr = tags.toArray ? tags.toArray() : tags;
      tagList = h(
        'div',
        { className: 'article-tags' },
        tagArr.map(function (tag, i) {
          return h('span', { key: 'tag-' + i, className: 'tag' }, '#' + tag);
        })
      );
    }

    children.push(
      h(
        'footer',
        { key: 'footer', className: 'article-footer' },
        h(
          'div',
          { key: 'author', className: 'author-info' },
          h('strong', null, labels.author),
          author
        ),
        tagList
      )
    );

    return h('article', { className: 'article-preview' }, children);
  }

  CMS.registerPreviewTemplate('articles', ArticlePreview);
})();
