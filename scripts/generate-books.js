const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
  process.exit(1);
}

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/covers`;
const AFFILIATE_TAG = 'insidestory0d-20';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function affiliateUrl(url, meta) {
  const base = url || (meta.asin
    ? `https://www.amazon.com/dp/${meta.asin}`
    : meta.isbn10
      ? `https://www.amazon.com/dp/${meta.isbn10}`
      : '');
  if (!base) return '';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}tag=${AFFILIATE_TAG}`;
}

function coverUrl(book, meta) {
  if (meta.cover_image_url) return meta.cover_image_url;
  if (meta.cover_image_path) return `${STORAGE_BASE}/${meta.cover_image_path}`;
  if (book.cover_image_path) return `${STORAGE_BASE}/${book.cover_image_path}`;
  return 'public/placeholder-cover.jpg';
}

function formatAuthors(authors) {
  if (!authors || !authors.length) return '';
  if (typeof authors[0] === 'string') return authors.join(', ');
  if (authors[0] && authors[0].name) return authors.map(a => a.name).join(', ');
  return '';
}

function formatGenres(genre) {
  if (!genre || !genre.length) return '';
  return genre.slice(0, 2).join(' · ');
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scrollCard(book, meta) {
  const cover = coverUrl(book, meta);
  const title = meta.title || book.title;
  const authors = formatAuthors(meta.authors);
  const genres = formatGenres(meta.genre);
  const amazonUrl = affiliateUrl(book.amazon_url, meta);

  return `<div class="wyw-card">
            <img src="${cover}" alt="${esc(title)}" class="wyw-card-cover" loading="lazy" />
            <div class="wyw-card-body">
              <p class="wyw-card-title">${esc(title)}</p>
              ${authors ? `<p class="wyw-card-author">${esc(authors)}</p>` : ''}
              ${genres ? `<p class="wyw-card-genre">${esc(genres)}</p>` : ''}
              ${amazonUrl ? `<a href="${amazonUrl}" target="_blank" rel="noopener sponsored" class="wyw-amazon-btn">Buy on Amazon</a>` : ''}
            </div>
          </div>`;
}

function gridCard(book, meta) {
  const cover = coverUrl(book, meta);
  const title = meta.title || book.title;
  const authors = formatAuthors(meta.authors);
  const genres = formatGenres(meta.genre);
  const desc = stripHtml(meta.description || book.description || '');
  const truncDesc = desc.length > 250 ? desc.slice(0, 250) + '...' : desc;
  const amazonUrl = affiliateUrl(book.amazon_url, meta);

  return `<div class="rr-card">
              <div class="rr-card-cover-wrap">
                <img src="${cover}" alt="${esc(title)}" class="rr-card-cover" loading="lazy" />
              </div>
              <div class="rr-card-body">
                <p class="rr-card-title">${esc(title)}</p>
                ${authors ? `<p class="rr-card-author">${esc(authors)}</p>` : ''}
                ${genres ? `<p class="rr-card-genre">${esc(genres)}</p>` : ''}
                ${truncDesc ? `<p class="rr-card-desc">${esc(truncDesc)}</p>` : ''}
                ${amazonUrl ? `<a href="${amazonUrl}" target="_blank" rel="noopener sponsored" class="rr-amazon-btn">Buy on Amazon</a>` : '<p class="rr-coming-soon">Coming to Amazon soon</p>'}
              </div>
            </div>`;
}

async function main() {
  console.log('Fetching books from Supabase...');

  const { data, error } = await supabase
    .from('books')
    .select(`
      id, title, pen_name, amazon_url, cover_image_path, description,
      books_metadata(title, subtitle, authors, cover_image_path, cover_image_url, description, genre, asin, isbn10)
    `)
    .not('books_metadata_id', 'is', null);

  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }

  const books = (data || []).filter(b =>
    b.books_metadata && (b.books_metadata.asin || b.books_metadata.isbn10)
  );
  console.log(`Found ${books.length} books with metadata`);

  if (!books.length) {
    console.log('No books found — skipping HTML generation');
    return;
  }

  const ROOT = path.join(__dirname, '..');

  // Update books.html scroll strip (up to 6 books)
  const scrollCards = books.slice(0, 6).map(b => scrollCard(b, b.books_metadata)).join('\n          ');
  const scrollSection = `<div id="While-You-Wait" class="wyw-section">
          <h1 class="wyw-title">WHILE YOU WAIT...</h1>
          <p class="wyw-subtitle">Check out these books from other authors</p>
          <p class="wyw-disclaimer">As an Amazon Associate, I earn from qualifying purchases.</p>
          <div class="wyw-track">
          ${scrollCards}
          </div>
          <div class="wyw-footer">
            <a href="recommended-reads.html" class="wyw-see-more">See all recommended reads →</a>
          </div>
        </div>`;

  const booksHtmlPath = path.join(ROOT, 'books.html');
  let booksHtml = fs.readFileSync(booksHtmlPath, 'utf8');
  booksHtml = booksHtml.replace(
    /<!-- BOOKS_SCROLL_START -->[\s\S]*?<!-- BOOKS_SCROLL_END -->/,
    `<!-- BOOKS_SCROLL_START -->\n        ${scrollSection}\n        <!-- BOOKS_SCROLL_END -->`
  );
  fs.writeFileSync(booksHtmlPath, booksHtml);
  console.log('Updated books.html');

  // Update recommended-reads.html grid
  const gridCards = books.map(b => gridCard(b, b.books_metadata)).join('\n              ');

  const rrPath = path.join(ROOT, 'recommended-reads.html');
  let rrHtml = fs.readFileSync(rrPath, 'utf8');
  rrHtml = rrHtml.replace(
    /<!-- RR_GRID_START -->[\s\S]*?<!-- RR_GRID_END -->/,
    `<!-- RR_GRID_START -->\n              ${gridCards}\n              <!-- RR_GRID_END -->`
  );
  fs.writeFileSync(rrPath, rrHtml);
  console.log('Updated recommended-reads.html');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
