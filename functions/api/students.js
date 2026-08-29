export async function onRequestPost({ request, env }) {
  try {
    const b = await request.json();
    const name = String(b.name || '').trim().slice(0, 40);
    const year = String(b.year_group || '').toUpperCase();
    if (!name || !['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(year)) {
      return Response.json({error:'name and valid year_group required'},{status:400});
    }
    const birthYear = b.birth_year ? Number(b.birth_year) : null;
    const r = await env.DB.prepare(`
      INSERT INTO students(name,birth_year,current_year_group)
      VALUES(?,?,?)
      RETURNING id,name,birth_year,current_year_group,created_at
    `).bind(name, birthYear, year).first();
    return Response.json(r,{status:201});
  } catch (err) {
    return Response.json({error:'student_create_failed',detail:String(err?.message||err)},{status:500});
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const b=await request.json();
    const id=Number(b.id);
    const year=String(b.year_group||'').toUpperCase();
    if(!id || !['R','Y1','Y2','Y3','Y4','Y5','Y6'].includes(year)){
      return Response.json({error:'valid id and year_group required'},{status:400});
    }
    const r=await env.DB.prepare(`
      UPDATE students SET current_year_group=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? RETURNING id,name,birth_year,current_year_group,updated_at
    `).bind(year,id).first();
    if(!r) return Response.json({error:'student_not_found'},{status:404});
    return Response.json(r);
  } catch(err){
    return Response.json({error:'student_update_failed',detail:String(err?.message||err)},{status:500});
  }
}
