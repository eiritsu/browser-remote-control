# BOSS直聘 Content Extraction Selectors

Reference selectors for extracting job listings from BOSS直聘 (zhipin.com).
These are multi-strategy selectors that handle layout variations.

## Job Card Selectors

```css
/* Primary selectors */
.job-card-wrapper
[class*="job-card-box"]
[ka*="search_list_job"]
.job-list-box .job-card-wrapper
[class*="search-job-result"] li
```

## Field Extractors

| Field | Selectors |
|-------|-----------|
| Title | `.job-name`, `[class*="job-name"]`, `a[title]` (use `getAttribute('title')` as fallback) |
| Company | `.company-name`, `[class*="company-name"]`, `.company-text a` |
| Salary | `.salary`, `.job-limit .red`, `[class*="salary"]`, `span.salary` |
| Area | `.job-area`, `[class*="job-area"]`, `.job-area-wrapper span` |
| Tags | `.job-info .tag-list li`, `.tag-list span`, `[class*="tags"] span` |
| Experience | `.job-info .tag-list li:nth-child(1)`, `[class*="experience"]` |
| Education | `.job-info .tag-list li:nth-child(2)`, `[class*="education"]` |
| Link | `a` (first link in card) |

## Login Detection Selectors

| Element | Selectors |
|---------|-----------|
| Login button | `.btn-signin`, `[class*="login-btn"]`, `.nav-login`, `a[href*="login"]`, `.header-login-btn`, `.nologin` |
| User element | `.user-nav .label-text`, `[class*="user-name"]`, `.nav-figure img`, `[class*="avatar"]`, `.user-nav`, `.nav-figure` |

## Extraction Pattern

```javascript
const cards = document.querySelectorAll(
  '.job-card-wrapper, [class*="job-card-box"], [ka*="search_list_job]'
);
cards.forEach(card => {
  const title = card.querySelector('.job-name, [class*="job-name"]')
    ?.textContent?.trim() ||
    card.querySelector('a[title]')?.getAttribute('title') || '';
  const company = card.querySelector('.company-name, [class*="company-name"]')
    ?.textContent?.trim() || '';
  // ... more fields
});
```

## Notes

- BOSS直聘 uses dynamic class names that may change. The multi-selector approach
  provides resilience against layout updates.
- `a[title]` attribute is more reliable than `textContent` for job titles
  because titles may be truncated in the visible card.
- The `[ka*="search_list_job"]` attribute selector targets BOSS直聘's analytics
  attributes, which tend to be more stable than class names.
