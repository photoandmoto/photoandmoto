// Run from the photoandmoto project root:
// node patch-tunnistamatta.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'src/pages/fi/tunnistamatta.astro');
let c = fs.readFileSync(FILE, 'utf8');

// ── 1. Add tab button ──────────────────────────────────────────────────────
const TAB_ANCHOR = 'data-tab="laheta"';
const TAB_BTN = `\n        <button type="button" class="admin-tab" data-tab="hallitse">Hallitse galleriaa</button>`;
if (!c.includes('data-tab="hallitse"')) {
  // Find the laheta button closing tag and insert after it
  c = c.replace(
    /(data-tab="laheta"[^<]*<\/button>)/,
    `$1${TAB_BTN}`
  );
  console.log('✓ Added Hallitse tab button');
} else {
  console.log('· Hallitse tab button already present');
}

// ── 2. Add tabHallitse content div ────────────────────────────────────────
const TAB_CONTENT = `
      <!-- Hallitse galleriaa tab (admin only) -->
      <div id="tabHallitse" class="tab-content" style="display:none;">
        <div class="hallitse-section">
          <h3 class="upload-title">Hallitse galleriaa</h3>
          <div class="hallitse-top">
            <div class="hallitse-select-row">
              <select id="hallitseGallerySelect" class="inp inp--sel">
                <option value="">— valitse galleria —</option>
              </select>
              <button id="hallitseLoadBtn" class="btn" disabled>Lataa kuvat</button>
            </div>
            <div id="hallitseGalleryActions" class="hallitse-gallery-actions" style="display:none;">
              <button id="hallitseRenameGalleryBtn" class="btn btn--ghost">✏ Muuta nimeä</button>
              <button id="hallitseDeleteGalleryBtn" class="btn btn--danger">🗑 Poista galleria</button>
            </div>
          </div>
          <div id="hallitseMsg" class="upload-msg" style="margin-top:8px;"></div>
          <div id="hallitseGrid" class="hallitse-grid"></div>
        </div>
      </div>
`;

if (!c.includes('id="tabHallitse"')) {
  c = c.replace('<!-- Modal overlay -->', `${TAB_CONTENT}\n      <!-- Modal overlay -->`);
  console.log('✓ Added tabHallitse content div');
} else {
  console.log('· tabHallitse content div already present');
}

// ── 3. Tab switching — add hallitse ───────────────────────────────────────
const TAB_SWITCH_OLD = `document.getElementById('tabLaheta').style.display=tab==='laheta'?'':'none';`;
const TAB_SWITCH_NEW = `document.getElementById('tabLaheta').style.display=tab==='laheta'?'':'none';\n  document.getElementById('tabHallitse').style.display=tab==='hallitse'?'':'none';\n  if(tab==='hallitse' && adminPw && !document.getElementById('hallitseGallerySelect').options.length>1){loadHallitseGalleries();}`;

if (!c.includes("tabHallitse'.style.display=tab==='hallitse'")) {
  c = c.replace(TAB_SWITCH_OLD, TAB_SWITCH_NEW);
  console.log('✓ Updated tab switching logic');
} else {
  console.log('· Tab switching already updated');
}

// ── 4. Logout — reset hallitse tab ───────────────────────────────────────
const LOGOUT_OLD = `document.getElementById('tabLaheta').style.display='none';`;
const LOGOUT_NEW = `document.getElementById('tabLaheta').style.display='none';\n  document.getElementById('tabHallitse').style.display='none';`;

if (!c.includes("tabHallitse').style.display='none';")) {
  c = c.replace(LOGOUT_OLD, LOGOUT_NEW);
  console.log('✓ Updated logout logic');
} else {
  console.log('· Logout already updated');
}

// ── 5. JS additions ───────────────────────────────────────────────────────
const NEW_JS = `
// =====================================================================
// HALLITSE GALLERIAA TAB
// =====================================================================

let hallitseCurrentSlug = null;
let hallitsePhotos = [];

async function loadHallitseGalleries() {
  const sel = document.getElementById('hallitseGallerySelect');
  if (!sel) return;
  const galleries = await loadGalleries();
  sel.innerHTML = '<option value="">— valitse galleria —</option>' +
    galleries.map(g => \`<option value="\${escAttr(g.slug)}">\${esc(g.title)}</option>\`).join('');
  document.getElementById('hallitseLoadBtn').disabled = false;
}

async function loadHallitsePhotos() {
  const slug = document.getElementById('hallitseGallerySelect').value;
  if (!slug) return;
  hallitseCurrentSlug = slug;
  const msg  = document.getElementById('hallitseMsg');
  const grid = document.getElementById('hallitseGrid');
  msg.innerHTML = '<span class="u-load">Ladataan...</span>';
  grid.innerHTML = '';
  try {
    const r = await fetch('/api/mystery/gallery-manage', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({password: adminPw, action: 'list_gallery_photos', gallery_slug: slug}),
    });
    const data = await r.json();
    if (!r.ok || !data.success) {
      msg.innerHTML = \`<span class="u-err">\${esc(data.error || 'Virhe')}</span>\`;
      return;
    }
    hallitsePhotos = data.photos;
    msg.innerHTML = \`<span class="u-ok">\${data.photos.length} kuvaa — \${esc(data.title)}</span>\`;
    document.getElementById('hallitseGalleryActions').style.display = 'flex';
    renderHallitseGrid(data.photos, slug);
  } catch(e) {
    msg.innerHTML = \`<span class="u-err">Virhe: \${esc(e.message)}</span>\`;
  }
}

function renderHallitseGrid(photos, slug) {
  const grid = document.getElementById('hallitseGrid');
  if (!photos.length) {
    grid.innerHTML = '<div class="grid-empty">Galleria on tyhjä.</div>';
    return;
  }
  grid.innerHTML = photos.map(p => \`
    <div class="hcard">
      <div class="hcard-img">
        <img src="/galleries/\${escAttr(slug)}/\${escAttr(p.thumb)}" alt="" loading="lazy" />
      </div>
      <div class="hcard-caption" title="\${escAttr(p.caption)}">\${esc(p.caption)}</div>
      <div class="hcard-actions">
        <button class="btn btn--ghost hcard-edit" data-filename="\${escAttr(p.filename)}" data-caption="\${escAttr(p.caption)}">✏</button>
        <button class="btn btn--danger hcard-del" data-filename="\${escAttr(p.filename)}">🗑</button>
      </div>
    </div>\`).join('');

  grid.querySelectorAll('.hcard-del').forEach(btn => btn.addEventListener('click', async () => {
    const filename = btn.dataset.filename;
    if (!confirm(\`Poistetaanko kuva "\${filename}" galleriasta \${hallitseCurrentSlug}? Ei voi peruuttaa.\`)) return;
    btn.disabled = true;
    const msg = document.getElementById('hallitseMsg');
    msg.innerHTML = '<span class="u-load">Poistetaan...</span>';
    const r = await fetch('/api/mystery/gallery-manage', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({password: adminPw, action: 'delete_photo', gallery_slug: hallitseCurrentSlug, filename}),
    });
    const data = await r.json();
    if (data.success) {
      msg.innerHTML = \`<span class="u-ok">✓ Poistettu: \${esc(filename)}</span>\`;
      await loadHallitsePhotos();
    } else {
      msg.innerHTML = \`<span class="u-err">Virhe: \${esc(data.error)}</span>\`;
      btn.disabled = false;
    }
  }));

  grid.querySelectorAll('.hcard-edit').forEach(btn => btn.addEventListener('click', () => {
    const filename = btn.dataset.filename;
    const currentCaption = btn.dataset.caption;
    const newCaption = prompt('Uusi kuvateksti:', currentCaption);
    if (!newCaption || newCaption.trim() === currentCaption) return;
    const msg = document.getElementById('hallitseMsg');
    msg.innerHTML = '<span class="u-load">Tallennetaan...</span>';
    fetch('/api/mystery/gallery-manage', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({password: adminPw, action: 'update_caption', gallery_slug: hallitseCurrentSlug, filename, caption: newCaption.trim()}),
    }).then(r => r.json()).then(data => {
      if (data.success) {
        msg.innerHTML = '<span class="u-ok">✓ Kuvateksti päivitetty</span>';
        loadHallitsePhotos();
      } else {
        msg.innerHTML = \`<span class="u-err">Virhe: \${esc(data.error)}</span>\`;
      }
    });
  }));
}

document.getElementById('hallitseGallerySelect') && document.getElementById('hallitseGallerySelect').addEventListener('change', () => {
  document.getElementById('hallitseGalleryActions').style.display = 'none';
  document.getElementById('hallitseGrid').innerHTML = '';
  document.getElementById('hallitseMsg').innerHTML = '';
  hallitseCurrentSlug = null;
});

document.getElementById('hallitseLoadBtn') && document.getElementById('hallitseLoadBtn').addEventListener('click', loadHallitsePhotos);

document.getElementById('hallitseRenameGalleryBtn') && document.getElementById('hallitseRenameGalleryBtn').addEventListener('click', async () => {
  if (!hallitseCurrentSlug) return;
  const currentTitle = document.getElementById('hallitseGallerySelect').selectedOptions[0]?.text || '';
  const newTitle = prompt('Uusi nimi gallerialle:', currentTitle);
  if (!newTitle || newTitle.trim() === currentTitle) return;
  const msg = document.getElementById('hallitseMsg');
  msg.innerHTML = '<span class="u-load">Tallennetaan...</span>';
  const r = await fetch('/api/mystery/gallery-manage', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password: adminPw, action: 'rename_gallery', gallery_slug: hallitseCurrentSlug, title: newTitle.trim()}),
  });
  const data = await r.json();
  if (data.success) {
    msg.innerHTML = \`<span class="u-ok">✓ Nimi päivitetty: \${esc(data.title)}</span>\`;
    cachedGalleries = null;
    await loadHallitseGalleries();
  } else {
    msg.innerHTML = \`<span class="u-err">Virhe: \${esc(data.error)}</span>\`;
  }
});

document.getElementById('hallitseDeleteGalleryBtn') && document.getElementById('hallitseDeleteGalleryBtn').addEventListener('click', async () => {
  if (!hallitseCurrentSlug) return;
  const title = document.getElementById('hallitseGallerySelect').selectedOptions[0]?.text || hallitseCurrentSlug;
  if (!confirm(\`Poistetaanko galleria "\${title}"?\\n\\nGalleria poistetaan sivustolta seuraavassa käännöksessä. Kuvatiedostot säilyvät repossa.\`)) return;
  const msg = document.getElementById('hallitseMsg');
  msg.innerHTML = '<span class="u-load">Poistetaan...</span>';
  const r = await fetch('/api/mystery/gallery-manage', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password: adminPw, action: 'delete_gallery', gallery_slug: hallitseCurrentSlug}),
  });
  const data = await r.json();
  if (data.success) {
    msg.innerHTML = \`<span class="u-ok">✓ Galleria poistettu</span>\`;
    document.getElementById('hallitseGalleryActions').style.display = 'none';
    document.getElementById('hallitseGrid').innerHTML = '';
    hallitseCurrentSlug = null;
    hallitsePhotos = [];
    cachedGalleries = null;
    await loadHallitseGalleries();
  } else {
    msg.innerHTML = \`<span class="u-err">Virhe: \${esc(data.error)}</span>\`;
  }
});
`;

if (!c.includes('HALLITSE GALLERIAA TAB')) {
  // Insert before closing </script>
  c = c.replace('</script>', NEW_JS + '\n</script>');
  console.log('✓ Added Hallitse JS functions');
} else {
  console.log('· Hallitse JS already present');
}

// ── 6. CSS additions ──────────────────────────────────────────────────────
const NEW_CSS = `
  /* ===== HALLITSE GALLERIAA ===== */
  .hallitse-section{max-width:960px}
  .hallitse-top{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:8px}
  .hallitse-select-row{display:flex;gap:10px;align-items:center}
  .hallitse-gallery-actions{display:flex;gap:8px;align-items:center}
  .hallitse-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:16px}
  .hcard{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .hcard-img{aspect-ratio:4/3;overflow:hidden;background:#1a1a1a}
  .hcard-img img{width:100%;height:100%;object-fit:cover;display:block}
  .hcard-caption{font-size:.72rem;color:#555;padding:8px 10px;line-height:1.3;min-height:36px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hcard-actions{display:flex;gap:6px;padding:0 10px 10px}
  .hcard-actions .btn{font-size:.72rem;padding:6px 10px;flex:1}
  @media(max-width:900px){.hallitse-grid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:540px){.hallitse-grid{grid-template-columns:1fr}}
`;

if (!c.includes('HALLITSE GALLERIAA')) {
  c = c.replace('</style>', NEW_CSS + '\n</style>');
  console.log('✓ Added Hallitse CSS');
} else {
  console.log('· Hallitse CSS already present');
}

// ── Write back ────────────────────────────────────────────────────────────
fs.writeFileSync(FILE, c, 'utf8');
console.log('\n✅ tunnistamatta.astro patched successfully.');
