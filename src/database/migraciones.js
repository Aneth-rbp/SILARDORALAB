/**
 * Aplica las migraciones de la base de datos al arrancar la aplicación.
 *
 * El equipo del laboratorio se actualiza solo (electron-updater trae el
 * instalador nuevo), pero hasta ahora la parte de SQL había que correrla a mano
 * con `mysql -u root silar_db < database/xxx.sql`. Eso obliga a que alguien se
 * siente delante de esa máquina, y no siempre hay alguien. Así que se encarga
 * la aplicación: en cada arranque revisa qué archivos de `database/` faltan por
 * aplicar y los aplica.
 *
 * Reglas de la carpeta `database/`:
 *
 * - Los archivos de migración se llaman `NNN_lo_que_hace.sql`, con el número
 *   por delante. El orden de aplicación es ese número, así que un archivo nuevo
 *   lleva el siguiente número libre, nunca uno intermedio. Antes iban por
 *   nombre (`migration_add_...`) y el alfabeto los desordenaba: `emersion_speed`
 *   quedaba antes que `recipe_stages`, que es quien crea la tabla que el
 *   primero necesita, y la migración se saltaba en silencio.
 * - `schema.sql` NO es una migración: es la base creada desde cero
 *   (setup-database.bat) y lleva triggers con DELIMITER que este cargador no
 *   sabe partir. Por eso solo se toman los archivos con número.
 * - Solo se ejecuta lo que hace falta para la versión que se está instalando.
 *   Las migraciones viejas ya se aplicaron a mano en las máquinas que existen,
 *   así que en el primer arranque se anotan como hechas sin correrlas: ver
 *   PRIMERA_MIGRACION_AUTOMATICA. Lo único que se ejecuta de verdad es lo que
 *   se agregue de aquí en adelante.
 * - Aun así, una migración tiene que poder correrse sobre una base que ya la
 *   tiene sin romperse (los `IF ... EXISTS` contra `information_schema` que ya
 *   usan todas): una base recién creada con schema.sql ya trae el esquema
 *   completo, y la migración nueva se le va a pasar por encima igualmente.
 *
 * Si una migración falla se corta ahí y NO se sigue con las siguientes: la que
 * viene detrás puede depender de ella. Lo que no se hace nunca es tirar el
 * arranque: la aplicación levanta igual y el fallo queda en el log. Un equipo
 * que enciende y no abre es mucho peor que uno al que le falta una columna.
 */

const fs = require('fs');
const path = require('path');

const config = require('../../config/app.config');
const logger = require('../utils/logger');

// Solo `NNN_nombre.sql`. Deja fuera schema.sql y cualquier archivo suelto.
const PATRON_MIGRACION = /^(\d{3})_.+\.sql$/;

const TABLA_REGISTRO = 'schema_migrations';

// Primera migración que este cargador tiene permiso para ejecutar.
//
// Todo lo anterior (001 a 006) ya se aplicó a mano con el cliente de mysql en
// las máquinas que existen, así que volver a pasarlo no arreglaría nada y sí
// tocaría tablas con datos de experimentos reales. La primera vez que corre
// esto, las migraciones por debajo del corte se dan por hechas: se anotan en
// `schema_migrations` sin ejecutarlas.
//
// Una base recién creada tampoco las necesita: schema.sql ya trae el esquema
// completo, que es lo que hace setup-database.bat.
//
// Este número no se toca al agregar una migración nueva. Solo tendría sentido
// subirlo si algún día hubiera que volver a dar por buenas las de en medio.
const PRIMERA_MIGRACION_AUTOMATICA = 7;

/**
 * Parte un archivo .sql en sentencias sueltas.
 *
 * mysql2 no acepta varias sentencias en una sola llamada salvo que se abra la
 * conexión con `multipleStatements`, y esa conexión es la misma que usa toda la
 * aplicación: activarlo ahí ampliaría la superficie de inyección de cada
 * consulta del servidor por una comodidad de arranque. Sale más barato partir
 * aquí.
 *
 * El corte es por `;` fuera de literales y de comentarios. No entiende
 * DELIMITER, así que no sirve para triggers ni procedimientos: eso vive en
 * schema.sql, que este cargador no toca.
 */
function partirSentencias(sql) {
    const sentencias = [];
    let actual = '';
    let comilla = null;      // ', " o ` cuando estamos dentro de un literal
    let comentarioLinea = false;
    let comentarioBloque = false;

    for (let i = 0; i < sql.length; i++) {
        const caracter = sql[i];
        const siguiente = sql[i + 1];

        if (comentarioLinea) {
            if (caracter === '\n') {
                comentarioLinea = false;
                actual += caracter;
            }
            continue;
        }

        if (comentarioBloque) {
            if (caracter === '*' && siguiente === '/') {
                comentarioBloque = false;
                i++;
            }
            continue;
        }

        if (comilla) {
            actual += caracter;
            if (caracter === '\\' && comilla !== '`') {
                // Escape de MySQL: el siguiente carácter va tal cual, aunque
                // sea la comilla que cierra.
                if (siguiente !== undefined) {
                    actual += siguiente;
                    i++;
                }
            } else if (caracter === comilla) {
                // Una comilla doblada dentro del literal se ve aquí como cerrar
                // y volver a abrir. Para partir por `;` da igual: el resultado
                // neto es que seguimos dentro del literal.
                comilla = null;
            }
            continue;
        }

        // `--` solo abre comentario si le sigue un espacio (regla de MySQL:
        // `5--1` es una resta, no un comentario).
        if (caracter === '-' && siguiente === '-' && /\s/.test(sql[i + 2] ?? '\n')) {
            comentarioLinea = true;
            continue;
        }
        if (caracter === '#') {
            comentarioLinea = true;
            continue;
        }
        if (caracter === '/' && siguiente === '*') {
            comentarioBloque = true;
            i++;
            continue;
        }

        if (caracter === "'" || caracter === '"' || caracter === '`') {
            comilla = caracter;
            actual += caracter;
            continue;
        }

        if (caracter === ';') {
            sentencias.push(actual);
            actual = '';
            continue;
        }

        actual += caracter;
    }

    sentencias.push(actual);

    return sentencias.map((sentencia) => sentencia.trim()).filter((sentencia) => sentencia.length > 0);
}

/**
 * Lista los archivos de migración en el orden en que hay que aplicarlos.
 */
function listarArchivos(carpeta) {
    if (!fs.existsSync(carpeta)) {
        logger.warn(`No existe la carpeta de migraciones ${carpeta}; no se aplica ninguna`);
        return [];
    }

    return fs.readdirSync(carpeta)
        .filter((nombre) => PATRON_MIGRACION.test(nombre))
        .sort();
}

function numeroDe(archivo) {
    return Number(PATRON_MIGRACION.exec(archivo)[1]);
}

/**
 * Crea la tabla de registro si falta y, cuando la acaba de crear, da por
 * aplicadas las migraciones anteriores al corte sin ejecutarlas. Ver
 * PRIMERA_MIGRACION_AUTOMATICA.
 */
async function asegurarTablaRegistro(conexion, archivos) {
    const [existente] = await conexion.query(
        `SELECT COUNT(*) AS total FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [TABLA_REGISTRO]
    );

    if (existente[0].total > 0) return;

    await conexion.query(`
        CREATE TABLE ${TABLA_REGISTRO} (
            archivo VARCHAR(191) PRIMARY KEY,
            aplicada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Migraciones de database/ ya aplicadas'
    `);

    const heredadas = archivos.filter((archivo) => numeroDe(archivo) < PRIMERA_MIGRACION_AUTOMATICA);
    for (const archivo of heredadas) {
        await conexion.query(`INSERT INTO ${TABLA_REGISTRO} (archivo) VALUES (?)`, [archivo]);
    }

    logger.info(`Registro de migraciones creado; ${heredadas.length} anteriores se dan por aplicadas sin ejecutarlas`);
}

async function leerAplicadas(conexion) {
    const [filas] = await conexion.query(`SELECT archivo FROM ${TABLA_REGISTRO}`);
    return new Set(filas.map((fila) => fila.archivo));
}

/**
 * Aplica un archivo entero. Cada sentencia va por separado, pero las variables
 * de sesión (`SET @exist_...`) sobreviven entre llamadas porque compartimos la
 * conexión, que es justo de lo que dependen los `PREPARE ... EXECUTE` de las
 * migraciones.
 *
 * Sin transacción a propósito: MySQL hace commit implícito en cada ALTER TABLE,
 * así que envolverlo daría una sensación de atomicidad que no existe.
 */
async function aplicarArchivo(conexion, carpeta, archivo) {
    const sql = fs.readFileSync(path.join(carpeta, archivo), 'utf8');
    const sentencias = partirSentencias(sql);

    for (let i = 0; i < sentencias.length; i++) {
        try {
            // query() y no execute(): execute() usa el protocolo binario, que
            // no admite SET de variables de sesión, ni PREPARE, ni EXECUTE, que
            // es de lo que están hechas estas migraciones.
            await conexion.query(sentencias[i]);
        } catch (error) {
            const recorte = sentencias[i].replace(/\s+/g, ' ').slice(0, 160);
            throw new Error(`${archivo}, sentencia ${i + 1}/${sentencias.length} (${recorte}): ${error.message}`);
        }
    }

    await conexion.query(`INSERT INTO ${TABLA_REGISTRO} (archivo) VALUES (?)`, [archivo]);
}

/**
 * Punto de entrada. Devuelve el resumen para quien quiera mostrarlo, y no
 * lanza: el arranque nunca depende de que esto salga bien.
 */
async function aplicarPendientes(conexion, carpeta = config.paths.database) {
    const resumen = { aplicadas: [], pendientes: [], error: null };

    if (!conexion) {
        resumen.error = 'sin conexión a la base de datos';
        logger.warn('Migraciones omitidas: no hay conexión a la base de datos');
        return resumen;
    }

    try {
        const archivos = listarArchivos(carpeta);
        await asegurarTablaRegistro(conexion, archivos);
        const aplicadas = await leerAplicadas(conexion);
        resumen.pendientes = archivos.filter((archivo) => !aplicadas.has(archivo));

        if (resumen.pendientes.length === 0) {
            logger.info(`Base de datos al día (${archivos.length} migraciones ya aplicadas)`);
            return resumen;
        }

        logger.info(`Migraciones pendientes: ${resumen.pendientes.join(', ')}`);

        while (resumen.pendientes.length > 0) {
            const archivo = resumen.pendientes[0];
            await aplicarArchivo(conexion, carpeta, archivo);
            resumen.pendientes.shift();
            resumen.aplicadas.push(archivo);
            logger.info(`Migración aplicada: ${archivo}`);
        }

        logger.info(`Base de datos actualizada: ${resumen.aplicadas.length} migraciones aplicadas`);
    } catch (error) {
        resumen.error = error.message;
        // Ruidoso pero no fatal: el detalle queda en el log y la aplicación sigue.
        logger.error(`Fallo aplicando migraciones, se detiene ahí: ${error.message}`);
        if (resumen.pendientes.length > 0) {
            logger.error(`Quedan sin aplicar: ${resumen.pendientes.join(', ')}`);
        }
    }

    return resumen;
}

module.exports = {
    aplicarPendientes,
    // Se exportan para poder probarlos sin una base de datos delante.
    partirSentencias,
    listarArchivos
};
