// Asumo que tienes algo así:
const express = require('express');
const app = express();
const pool = require('./db'); // tu pool pg o conexión a DB

app.use(express.json());
app.use(express.static('public')); // sirviendo archivos públicos


app.get('/casas', async (req, res) => {
  const { usuario, mision, fechaInicio, fechaFin } = req.query;

  try {

    // 🔵 CASO USUARIO (tiene usuario → es user normal)
    if (usuario) {

  const q = `
    SELECT 
      c.*,

      -- 🔥 Estado calculado SOLO para este usuario
      (
        SELECT 
          CASE 
            WHEN MAX(
              CASE 
                WHEN v2.estado = 'visitada' THEN 3
                WHEN v2.estado = 'no_atendieron' THEN 2
                WHEN v2.estado = 'otro' THEN 1
                ELSE 0
              END
            ) = 3 THEN 'visitada'
            WHEN MAX(
              CASE 
                WHEN v2.estado = 'visitada' THEN 3
                WHEN v2.estado = 'no_atendieron' THEN 2
                WHEN v2.estado = 'otro' THEN 1
                ELSE 0
              END
            ) = 2 THEN 'no_atendieron'
            WHEN MAX(
              CASE 
                WHEN v2.estado = 'visitada' THEN 3
                WHEN v2.estado = 'no_atendieron' THEN 2
                WHEN v2.estado = 'otro' THEN 1
                ELSE 0
              END
            ) = 1 THEN 'otro'
            ELSE NULL
          END
        FROM visitas v2
        WHERE v2.casa_id = c.id
        AND v2.usuario = $1
      ) as estado,

      COALESCE(
        json_agg(
          json_build_object(
            'estado', v.estado,
            'comentario', v.comentario,
            'fecha', v.fecha
          )
        ) FILTER (WHERE v.usuario = $1),
        '[]'
      ) as historial

    FROM casas c
    LEFT JOIN visitas v ON v.casa_id = c.id

    WHERE c.asignado_a ILIKE $1
    ${mision ? 'AND c.mision = $2' : ''}

    GROUP BY c.id
    ORDER BY c.fecha_asignacion ASC
  `;

  const params = mision ? [usuario, mision] : [usuario];

  const result = await pool.query(q, params);
  return res.json(result.rows);
}

    // 🟢 CASO ADMIN (no hay usuario)

    let whereConditions = [];
    let params = [];

    if (mision) {
      params.push(mision);
      whereConditions.push(`c.mision = $${params.length}`);
    }

    if (fechaInicio && fechaFin) {
      params.push(fechaInicio);
      params.push(fechaFin);
      whereConditions.push(`v.fecha BETWEEN $${params.length - 1} AND $${params.length}`);
    }

    const whereClause = whereConditions.length
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    const q = `
      SELECT 
        c.*,
        COALESCE(
          json_agg(
            json_build_object(
              'usuario', v.usuario,
              'estado', v.estado,
              'comentario', v.comentario,
              'fecha', v.fecha
            )
          ) FILTER (WHERE v.id IS NOT NULL),
          '[]'
        ) as historial
      FROM casas c
      LEFT JOIN visitas v ON v.casa_id = c.id
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.id ASC
    `;

    const result = await pool.query(q, params);
    return res.json(result.rows);

  } catch (e) {
    console.error(e);
    res.status(500).send('Error al obtener casas');
  }
});

// Endpoint para asignar casas
app.post('/asignar', async (req, res) => {
  const { usuario, ids, fecha } = req.body;

  // Validaciones
  if (!usuario || !ids || !Array.isArray(ids) || !fecha) {
    return res.status(400).send('Faltan datos (usuario, ids o fecha)');
  }

  try {
    const q = `
      UPDATE casas 
      SET asignado_a = $1, fecha_asignacion = $2
      WHERE id = ANY($3::int[])
    `;

    await pool.query(q, [usuario, fecha, ids]);

    res.sendStatus(200);

  } catch (e) {
    console.error(e);
    res.status(500).send('Error al asignar casas');
  }
});


// Endpoint para desasignar casas (borra estado y comentario también)
app.post('/desasignar', async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).send('Faltan datos');
  }
  try {
    const q = 'UPDATE casas SET asignado_a = NULL WHERE id = ANY($1::int[])';
    await pool.query(q, [ids]);
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al desasignar casas');
  }
});

app.post('/actualizar', async (req, res) => {
  const { id, estado, comentario, usuario } = req.body;

  if (!id || !estado || !usuario)
    return res.status(400).send('Faltan datos');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Insertar visita
    await client.query(
      `
      INSERT INTO visitas (casa_id, usuario, estado, comentario)
      VALUES ($1, $2, $3, $4)
      `,
      [id, usuario, estado, comentario]
    );

    // 2️⃣ Recalcular estado con prioridad
    const prioridadQuery = `
      SELECT 
        MAX(
          CASE 
            WHEN estado = 'visitada' THEN 3
            WHEN estado = 'no_atendieron' THEN 2
            WHEN estado = 'otro' THEN 1
            ELSE 0
          END
        ) as prioridad
      FROM visitas
      WHERE casa_id = $1
    `;

    const r = await client.query(prioridadQuery, [id]);
    const prioridad = Number(r.rows[0].prioridad);

    let estadoFinal = null;

    if (prioridad === 3) estadoFinal = 'visitada';
    else if (prioridad === 2) estadoFinal = 'no_atendieron';
    else if (prioridad === 1) estadoFinal = 'otro';

    await client.query(
      `UPDATE casas SET estado = $1 WHERE id = $2`,
      [estadoFinal, id]
    );

    await client.query('COMMIT');

    res.sendStatus(200);

  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).send('Error al actualizar');
  } finally {
    client.release();
  }
});


app.post('/agregar', async (req, res) => {
  const { direccion, latitud, longitud, mision } = req.body;
  if (!direccion || !latitud || !longitud || !mision) {
    return res.status(400).send('Faltan datos');
  }
  try {
    const q = 'INSERT INTO casas (direccion, latitud, longitud, mision) VALUES ($1, $2, $3, $4)';
    await pool.query(q, [direccion, latitud, longitud, mision]);
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al agregar casa');
  }
});

app.post('/eliminar', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send('Falta ID');
  try {
    await pool.query('DELETE FROM casas WHERE id = $1', [id]);
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al eliminar casa');
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor corriendo en puerto ${port}`));
