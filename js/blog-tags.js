/* Tag filtering for /blog/.
 *
 * The only JavaScript on a site page. It is progressive enhancement: without
 * it every post is listed (which is the correct default), each post's tags are
 * still visible, and the tag links still work — they just navigate to
 * /blog/?tag=x and land on an unfiltered list.
 *
 * Post tags live in data-tags on each .row. Nothing here needs updating when
 * you add a post; give the row a data-tags attribute and it is picked up.
 */
(function () {
  var list = document.querySelector('[data-taglist]');
  if (!list) return;

  var rows = Array.prototype.slice.call(list.querySelectorAll('.row[data-tags]'));
  if (!rows.length) return;

  // Collect every tag in document order, de-duplicated.
  var tags = [];
  rows.forEach(function (row) {
    row.dataset.tags.split(/\s+/).forEach(function (t) {
      if (t && tags.indexOf(t) === -1) tags.push(t);
    });
  });
  tags.sort();

  var bar = document.querySelector('[data-tagbar]');
  if (!bar) return;

  var note = document.createElement('p');
  note.className = 'empty-note';
  note.hidden = true;
  list.parentNode.insertBefore(note, list.nextSibling);

  function label(t) { return t.replace(/-/g, ' '); }

  function apply(tag, push) {
    var shown = 0;
    rows.forEach(function (row) {
      var match = !tag || row.dataset.tags.split(/\s+/).indexOf(tag) !== -1;
      row.hidden = !match;
      if (match) shown++;
    });
    bar.querySelectorAll('.tagbtn').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.tag === (tag || '')));
    });
    note.hidden = shown !== 0;
    if (shown === 0) note.textContent = 'No posts tagged “' + label(tag) + '”.';

    var url = tag ? '?tag=' + encodeURIComponent(tag) : location.pathname;
    if (push) history.pushState({ tag: tag }, '', url);
  }

  function button(tag, text) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tagbtn';
    b.dataset.tag = tag;
    b.textContent = text;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { apply(tag, true); });
    return b;
  }

  var lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = 'Filter';
  bar.appendChild(lbl);
  bar.appendChild(button('', 'All'));
  tags.forEach(function (t) { bar.appendChild(button(t, label(t))); });
  bar.hidden = false;

  // Tag links inside rows filter in place rather than navigating.
  list.addEventListener('click', function (e) {
    var a = e.target.closest('.tags a');
    if (!a) return;
    e.preventDefault();
    apply(a.dataset.tag, true);
    bar.scrollIntoView({ block: 'nearest' });
  });

  window.addEventListener('popstate', function () {
    apply(new URLSearchParams(location.search).get('tag') || '', false);
  });

  apply(new URLSearchParams(location.search).get('tag') || '', false);
})();
