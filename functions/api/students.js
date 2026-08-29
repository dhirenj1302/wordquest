export async function onRequestPost({ request, env }) {
  const b=await request.json();
  if(!b.name || !b.year_group) return Response.json({error:'name and year_group required'},{status:400});
  const r=await env.DB.prepare(`INSERT INTO students(name,birth_year,current_year_group) VALUES(?,?,?) RETURNING *`)
    .bind(b.name,b.birth_year||null,b.year_group).first();
  return Response.json(r,{status:201});
}
