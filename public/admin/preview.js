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
