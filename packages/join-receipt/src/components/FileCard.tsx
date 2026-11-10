import { FORMAT_LABEL, type TableProfile } from '@data-tools/core';

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (x: number) => (x === 0 ? '0%' : x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`);

/** Let long column names wrap after an underscore or space, never in the middle of a word. */
function breakable(name: string) {
  return name.split(/(?<=[_ ])/).map((part, i) => <span key={i}>{part}{i < name.length ? <wbr /> : null}</span>);
}

export function FileCard({ profile, grain }: { profile: TableProfile; grain: string }) {
  return (
    <article className="file" aria-labelledby={`f-${profile.table}`}>
      <header>
        <h3 id={`f-${profile.table}`}>{profile.file}</h3>
        <p className="meta">{fmt(profile.rows)} rows · {grain}</p>
        {profile.warning && <p className="warn" role="note">{profile.warning}</p>}
        {profile.sheet && (
          <p className="meta">
            From sheet "{profile.sheet.sheet}", header on row {profile.sheet.headerRow}, data through row {profile.sheet.lastRow}.
            {profile.sheet.sheetCount > 1 && ` The workbook has ${profile.sheet.sheetCount} sheets, and this is the first one with a table in it.`}
          </p>
        )}
      </header>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={`Columns in ${profile.file}`}>
        <table>
          <thead><tr><th scope="col">Column</th><th scope="col">Looks like</th><th scope="col">Distinct</th><th scope="col">Empty</th></tr></thead>
          <tbody>
            {profile.columns.map((c) => (
              <tr key={c.name}>
                <th scope="row"><code className="colname">{breakable(c.name)}</code>{c.unique && <span className="tag" title="Every row has a different value">unique</span>}</th>
                <td><span className={`chip f-${c.format}`}>{FORMAT_LABEL[c.format]}</span></td>
                <td className="num">{fmt(c.distinct)}</td>
                <td className="num">{pct(c.nullPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
