// Asumo que tienes algo así:
const express = require('express');
const app = express();
const pool = require('./db'); // tu pool pg o conexión a DB

app.use(express.json());
app.use(express.static('public')); // sirviendo archivos públicos

// VOLVER AL ANTEERIOR SI NO SANDSAAAAAAAA 
app.get('/casas', async (req, res) => {
  const { usuario, mision } = req.query;

  try {
    if (usuario && mision) {
      const result = await pool.query(
  `
  SELECT *
  FROM casas
  WHERE asignado_a ILIKE $1
    AND fecha_asignacion IS NOT NULL
    AND fecha_asignacion::date <= CURRENT_DATE
    AND mision=$2
  ORDER BY fecha_asignacion ASC
  `,
  [usuario, mision]
);
      return res.json(result.rows);
    } else if (mision) {
      const result = await pool.query('SELECT * FROM casas where mision=$1', [mision]);
      return res.json(result.rows);
    }else {
      const result = await pool.query('SELECT * FROM casas');
      return res.json(result.rows);
    }
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
    const q = 'UPDATE casas SET asignado_a = NULL, estado = NULL, comentario = NULL WHERE id = ANY($1::int[])';
    await pool.query(q, [ids]);
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al desasignar casas');
  }
});

// Endpoint para actualizar estado y comentario de casa
app.post('/actualizar', async (req, res) => {
  const { id, estado, comentario } = req.body;
  if (!id || !estado) return res.status(400).send('Faltan datos');
  try {
    const q = 'UPDATE casas SET estado = $1, comentario = $2 WHERE id = $3';
    await pool.query(q, [estado, comentario, id]);
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al actualizar');
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
