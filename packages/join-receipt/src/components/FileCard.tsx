import { FORMAT_LABEL, type TableProfile } from '@data-tools/core';

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (x: number) => (x === 0 ? '0%' : x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`);

export function FileCard({ profile, grain }: { profile: TableProfile; grain: string }) {
  return (
    <article className="file" aria-labelledby={`f-${profile.table}`}>
      <header>
        <h3 id={`f-${profile.table}`}>{profile.file}</h3>
        <p className="meta">{fmt(profile.rows)} rows · {grain}</p>
      </header>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Column</th><th scope="col">Looks like</th><th scope="col">Distinct</th><th scope="col">Empty</th></tr></thead>
          <tbody>
            {profile.columns.map((c) => (
              <tr key={c.name}>
                <th scope="row"><code>{c.name}</code>{c.unique && <span className="tag" title="Every row has a different value">unique</span>}</th>
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
