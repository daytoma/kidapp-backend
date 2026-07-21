/**
 * reset_db.js — Script de utilidad para limpiar la base de datos del sistema NB-IoT.
 * 
 * Uso:
 *   node src/reset_db.js --full      → Elimina TODOS los datos (incidentes y medios)
 *   node src/reset_db.js --media     → Elimina solo los medios (fotos/audios), conserva incidentes
 *   node src/reset_db.js --trim N    → Conserva los últimos N incidentes, elimina el resto
 *
 * El archivo SQLite se compacta automáticamente con VACUUM al finalizar.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'security_system.sqlite');
const db = new sqlite3.Database(dbPath);

const args = process.argv.slice(2);
const mode = args[0] || '--help';
const trimCount = parseInt(args[1]) || 10;

const run = (sql, params = []) =>
    new Promise((resolve, reject) =>
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        })
    );

const get = (sql, params = []) =>
    new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        })
    );

async function main() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   NB-IoT Security DB — Reset Utility     ║');
    console.log('╚══════════════════════════════════════════╝\n');

    // Estadísticas iniciales
    const incidentCount = await get('SELECT COUNT(*) as c FROM incidents');
    const mediaCount    = await get('SELECT COUNT(*) as c FROM incident_media');
    const sizeRow       = await get("SELECT page_count * page_size / 1024 / 1024 as mb FROM pragma_page_count(), pragma_page_size()");
    console.log(`📊 Estado actual:`);
    console.log(`   Incidentes : ${incidentCount?.c ?? 0}`);
    console.log(`   Medios     : ${mediaCount?.c ?? 0}`);
    console.log(`   Tamaño DB  : ~${sizeRow?.mb ?? '?'} MB\n`);

    if (mode === '--full') {
        console.log('🔴 Modo: BORRADO COMPLETO');
        const m = await run('DELETE FROM incident_media');
        const i = await run('DELETE FROM incidents');
        await run("DELETE FROM sqlite_sequence WHERE name='incident_media'");
        await run("DELETE FROM sqlite_sequence WHERE name='incidents'");
        console.log(`   ✓ Eliminados ${m} medios y ${i} incidentes.`);

    } else if (mode === '--media') {
        console.log('🟡 Modo: BORRADO DE MEDIOS (conservando incidentes)');
        const m = await run('DELETE FROM incident_media');
        await run("DELETE FROM sqlite_sequence WHERE name='incident_media'");
        console.log(`   ✓ Eliminados ${m} registros de medios.`);

    } else if (mode === '--trim') {
        console.log(`🟠 Modo: RECORTE — conservando los últimos ${trimCount} incidentes`);
        // Obtener IDs a conservar
        const toKeep = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id FROM incidents ORDER BY last_update DESC LIMIT ?`,
                [trimCount],
                (err, rows) => { if (err) reject(err); else resolve(rows.map(r => r.id)); }
            );
        });

        if (toKeep.length === 0) {
            console.log('   ℹ No hay incidentes que conservar.');
        } else {
            const placeholders = toKeep.map(() => '?').join(',');
            const m = await run(`DELETE FROM incident_media WHERE incident_id NOT IN (${placeholders})`, toKeep);
            const i = await run(`DELETE FROM incidents WHERE id NOT IN (${placeholders})`, toKeep);
            console.log(`   ✓ Eliminados ${m} medios y ${i} incidentes antiguos.`);
            console.log(`   ✓ Conservados ${toKeep.length} incidentes recientes.`);
        }

    } else {
        console.log('Uso:');
        console.log('  node src/reset_db.js --full      → Borrar TODO');
        console.log('  node src/reset_db.js --media     → Borrar solo medios');
        console.log('  node src/reset_db.js --trim N    → Conservar últimos N incidentes');
        db.close();
        return;
    }

    // Compactar la DB para liberar espacio en disco
    console.log('\n⚙️  Ejecutando VACUUM para compactar el archivo SQLite...');
    await run('VACUUM');
    
    const sizeAfter = await get("SELECT page_count * page_size / 1024 / 1024 as mb FROM pragma_page_count(), pragma_page_size()");
    console.log(`✅ ¡Hecho! Tamaño tras limpieza: ~${sizeAfter?.mb ?? '?'} MB`);
    console.log('\nRecuerda reiniciar el backend después de limpiar la DB.');
    db.close();
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    db.close();
    process.exit(1);
});
