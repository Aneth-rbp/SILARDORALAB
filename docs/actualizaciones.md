# Actualizaciones remotas (OTA)

El equipo instalado en el laboratorio se actualiza solo desde los Releases de
GitHub de este repositorio. No hace falta compilar a mano ni llevar el
instalador físicamente.

## Cómo publicar una versión

```bash
npm version patch
git push --follow-tags
```

`npm version` sube la versión en `package.json`, crea el commit y el tag `vX.Y.Z`.
Al empujar el tag, el workflow [release.yml](../.github/workflows/release.yml)
compila en un runner de Windows y publica el instalador junto con `latest.yml` y
el `.blockmap` como Release.

Usa `minor` en vez de `patch` para cambios de funcionalidad y `major` para
cambios que rompan compatibilidad. El tag **debe** coincidir con la versión de
`package.json`; `npm version` se encarga de eso.

## Cómo llega al laboratorio

La app instalada consulta el feed 15 segundos después de arrancar y luego cada
4 horas. Si encuentra una versión mayor la descarga en segundo plano y avisa
cuando está lista.

La descarga es **diferencial**: gracias al `.blockmap` solo baja los bloques del
instalador que cambiaron. Un cambio de puro JavaScript pesa unos pocos MB en vez
de los ~80 MB del instalador completo.

También hay un botón manual en el menú **Sistema → Buscar Actualizaciones**.

## Protecciones

Reiniciar la aplicación a media receta abortaría el proceso químico, así que
antes de ofrecer la instalación el updater consulta `GET /api/system/busy`. Si
hay un proceso en `running` o `paused`, la instalación se pospone y se reintenta
cada 10 minutos. Ante cualquier duda (base de datos caída, timeout, respuesta
ilegible) ese endpoint responde `busy: true`, para nunca interrumpir a ciegas.

Antes de lanzar el instalador se cierra el proceso hijo del servidor
(`stopServer()` en [main.js](../src/main.js)). Es obligatorio: mientras siga
vivo mantiene tomados el puerto serial y el binario nativo de `serialport`, y
NSIS no puede reemplazar archivos en uso.

Si el usuario elige "Más tarde", la actualización queda pendiente y se aplica
sola la próxima vez que cierre la aplicación.

Un fallo de red nunca bloquea el arranque: se registra y la app sigue
funcionando con la versión instalada.

## Qué esperar en el equipo de MTY

- **Windows pedirá permiso de administrador** al instalar. La instalación es
  `perMachine: true` (va a Archivos de Programa), así que alguien tiene que
  aceptar el UAC. Para evitarlo habría que cambiar a instalación por usuario en
  la configuración `nsis` de `package.json`.
- **Las migraciones de base de datos siguen siendo manuales.** Si una versión
  nueva necesita columnas o tablas nuevas, hay que correr el SQL en el MySQL de
  MTY antes o durante el despliegue. El OTA no lo hace.
- **El firmware del Arduino es un canal aparte.** `electron-updater` solo
  actualiza la aplicación de escritorio. Si el cambio incluye
  `SILAR_Control.ino`, hay que flashear el Arduino con el IDE en sitio.

## Ajustes por equipo sin recompilar

Los valores por defecto apuntan a XAMPP: MariaDB en `127.0.0.1:3306` con `root`
sin contraseña. Si un equipo necesita otra cosa (contraseña en root, MySQL en
otro puerto, un COM fijo para el Arduino), se crea este archivo **en el equipo**,
sin tocar el código ni publicar una versión:

```
%APPDATA%\SILAR System\silar-config.json
```

```json
{
  "database": { "password": "loQueSea", "port": 3307 },
  "arduino": { "port": "COM3" }
}
```

Solo hay que incluir las claves que se quieren cambiar; el resto conserva su
valor por defecto. El archivo vive en la carpeta de datos del usuario, así que
**sobrevive a las actualizaciones**. Si tiene un JSON inválido se ignora y se
avisa en el log, sin impedir el arranque.

Para desarrollo con MySQL en Docker en vez de XAMPP, lo mismo se puede hacer con
variables de entorno: `DB_PASSWORD`, `DB_PORT`, `DB_HOST`.

## Diagnóstico

El updater escribe su propio log en la carpeta de datos del usuario, no en la
carpeta de la aplicación (que en instalación perMachine no es escribible):

```
%APPDATA%\SILAR System\logs\updater.log
```

Ahí quedan los chequeos, las descargas, las instalaciones pospuestas y los
errores de red.

## Cambiar el destino de publicación

El feed se configura en el bloque `build.publish` de `package.json`. Para usar un
servidor propio en vez de GitHub Releases, se cambia el provider a `generic` con
la URL donde se suban el `.exe`, el `latest.yml` y el `.blockmap`.

`releaseType: "release"` publica el Release de inmediato. Cambiarlo a `"draft"`
agrega una puerta manual: el build sube los archivos pero nadie se actualiza
hasta que se publique el Release desde GitHub.
