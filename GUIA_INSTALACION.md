# Guía de Instalación y Configuración - Sistema SILAR

## 📋 Índice

1. [Requisitos Previos](#requisitos-previos)
2. [Paso 1: Subir Código al Arduino](#paso-1-subir-código-al-arduino)
3. [Paso 2: Configurar Base de Datos](#paso-2-configurar-base-de-datos)
4. [Paso 3: Instalar Dependencias](#paso-3-instalar-dependencias)
5. [Paso 4: Iniciar el Servidor](#paso-4-iniciar-el-servidor)
6. [Paso 5: Probar el Sistema](#paso-5-probar-el-sistema)
7. [Paso 6: Calibrar Posiciones (Primera Vez)](#paso-6-calibrar-posiciones-primera-vez)
8. [Empaquetado para Distribución](#empaquetado-para-distribución)
9. [Solución de Problemas](#solución-de-problemas)

---

## Requisitos Previos

Antes de comenzar, asegúrate de tener instalado:

- ✅ **Node.js** (versión 16 o superior)
- ✅ **XAMPP** con MySQL ejecutándose
- ✅ **Arduino IDE** (para subir el código al Arduino)
- ✅ **Arduino Mega 2560 Rev3** conectado por USB
- ✅ **Puerto 3000** disponible para el servidor web

---

## Paso 1: Subir Código al Arduino

### 1.1 Abrir Arduino IDE

1. Abre **Arduino IDE**
2. Abre el archivo: `src/arduino/arduino-sketch/SILAR_Control.ino`

### 1.2 Configurar Arduino IDE

1. **Seleccionar Placa:**
   - Ve a: `Tools → Board → Arduino Mega or Mega 2560`

2. **Seleccionar Puerto:**
   - Ve a: `Tools → Port → COM5` (o el puerto donde esté tu Arduino)
   - Para verificar el puerto:
     - Windows: Administrador de Dispositivos → Puertos (COM y LPT)
     - Busca "Arduino Mega 2560" o "USB Serial Port"

3. **Velocidad Serial:**
   - Asegúrate de que esté configurado en **9600 baud**

### 1.3 Verificar y Subir Código

1. **Verificar código:**
   - Presiona `Ctrl+R` o ve a `Sketch → Verify/Compile`
   - Debe compilar sin errores

2. **Subir código:**
   - Presiona `Ctrl+U` o ve a `Sketch → Upload`
   - Espera a que termine la carga

3. **Verificar en Monitor Serial:**
   - Ve a: `Tools → Serial Monitor`
   - Configura velocidad: **9600 baud**
   - Deberías ver:
     ```
     Sistema SILAR Iniciado
     Hardware: Arduino Mega 2560 Rev3
     Documento: MOC-ELEC-001
     ```

### ✅ Verificación Exitosa

Si ves el mensaje anterior, el Arduino está listo. **Cierra el Monitor Serial** antes de continuar (el servidor Node.js necesita acceso al puerto serial).

---

## Paso 2: Configurar Base de Datos

### 2.1 Verificar MySQL

1. **Abrir XAMPP Control Panel**
2. **Iniciar MySQL** (debe estar en verde)
3. Verificar que el puerto **3306** esté disponible

### 2.2 Ejecutar Script de Configuración

Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
setup-database.bat
```

O usando npm:

```bash
npm run setup-db
```

### 2.3 Verificar Configuración

El script debería mostrar:

```
✅ MySQL está ejecutándose correctamente
✅ Base de datos creada exitosamente
✅ Esquema de base de datos creado exitosamente
✅ Usuarios de prueba creados
✅ Configuración verificada correctamente
```

### 2.4 Usuarios Creados

Se crean automáticamente estos usuarios:

| Usuario | Contraseña | Rol |
|---------|------------|-----|
| `admin` | `admin123` | Administrador |
| `dr.martinez` | `password123` | Usuario |

### 2.5 Configuración de Base de Datos

- **Base de datos:** `silar_db`
- **Host:** `localhost`
- **Usuario MySQL:** `root`
- **Contraseña MySQL:** (vacía por defecto en XAMPP)
- **Puerto:** `3306`

---

## Paso 3: Instalar Dependencias

Si es la primera vez que ejecutas el proyecto:

```bash
npm install
```

Esto instalará todas las dependencias necesarias:
- Express (servidor web)
- Socket.IO (comunicación en tiempo real)
- MySQL2 (conexión a base de datos)
- SerialPort (comunicación con Arduino)
- Electron (aplicación de escritorio)

**Nota:** La instalación de `serialport` puede tardar varios minutos ya que necesita compilar módulos nativos.

---

## Paso 4: Iniciar el Servidor

### Opción A: Servidor Web (Recomendado para Pruebas)

```bash
npm run web
```

O directamente:

```bash
node server.js
```

Deberías ver en la consola:

```
✅ Base de datos conectada
✅ Servidor iniciado en http://localhost:3000
✅ Socket.IO configurado
```

### Opción B: Aplicación Electron (Opcional)

```bash
npm run dev
```

Esto abrirá la aplicación como programa de escritorio.

---

## Paso 5: Probar el Sistema

### 5.1 Acceder al Sistema

1. Abre tu navegador web
2. Ve a: **http://localhost:3000**
3. Inicia sesión con:
   - Usuario: `admin`
   - Contraseña: `admin123`

### 5.2 Verificar Conexión Arduino

1. Ve a la pantalla **"Control Manual"** en el menú
2. Deberías ver:
   - 🟢 **Estado:** Conectado
   - 🟢 **Puerto:** COM5 (o el puerto de tu Arduino)
   - 🟢 **Modo:** MANUAL o AUTOMATIC

Si no está conectado:
- Verifica que el Arduino esté conectado por USB
- Verifica que el Monitor Serial de Arduino IDE esté cerrado
- Haz clic en "Conectar" si hay un botón disponible

### 5.3 Pruebas Básicas

#### Prueba 1: Comandos Manuales

1. En **Control Manual**, prueba:
   - ✅ **HOME:** Ejecutar secuencia de home
   - ✅ **Mover Y:** Botones Y+ / Y-
   - ✅ **Mover Z:** Botones Z+ / Z-
   - ✅ **Paro de Emergencia:** Botón STOP

#### Prueba 2: Accesorios

Desde el Monitor Serial del Arduino (9600 baud), prueba:

```
LAMP_ON      → Encender lámpara
LAMP_OFF     → Apagar lámpara
FAN_ON       → Encender ventilador
FAN_OFF      → Apagar ventilador
STATUS       → Ver estado completo
```

#### Prueba 3: Proceso Automático

1. Ve a la pantalla **"Recetas"**
2. Selecciona una receta existente
3. Haz clic en **"Ejecutar"**
4. Ve a la pantalla **"Proceso"**
5. Deberías ver:
   - Timer iniciado
   - Estado: "Ejecutándose"
   - En el Monitor Serial del Arduino deberías ver:
     ```
     PARAMETROS_RECIBIDOS: Ciclos=X, Wait0=...
     PROCESO_INICIADO: Ciclos=X
     CICLO_INICIADO: 1/X
     INMERSION_INICIADA: Y1
     ...
     ```

---

## Paso 6: Calibrar Posiciones (Primera Vez)

### 6.1 Calibrar Posiciones Y

Las posiciones Y2, Y3, Y4 deben ajustarse según tu hardware real.

1. **Ejecutar HOME** primero para establecer referencia
2. **Mover manualmente** a cada posición de solución
3. **Anotar** la posición Y en pasos desde home
4. **Editar** el código Arduino en las líneas 79-82:

```cpp
// En src/arduino/arduino-sketch/SILAR_Control.ino
const long POS_Y1 = 0;      // ✅ Correcto (home)
const long POS_Y2 = 5000;  // ⚠️ CAMBIAR por valor real
const long POS_Y3 = 10000; // ⚠️ CAMBIAR por valor real
const long POS_Y4 = 15000; // ⚠️ CAMBIAR por valor real
```

5. **Subir código actualizado** al Arduino

### 6.2 Calibrar Longitud de Inmersión

El parámetro `dippingLength` también puede necesitar ajuste:

- Valor por defecto: 10000 pasos
- Ajusta según la profundidad real de inmersión necesaria
- Puede configurarse por receta en la interfaz web

---

## Empaquetado para Distribución

Si quieres crear un instalador para distribuir el sistema:

### 6.1 Empaquetar Aplicación

```bash
npm run build
```

Esto creará un instalador en:
```
dist/SILAR-System-Setup-2.0.0.exe
```

### 6.2 Instalar Aplicación Empaquetada

1. Ejecuta el instalador `SILAR-System-Setup-2.0.0.exe`
2. Sigue el asistente de instalación
3. La aplicación se instalará como programa de Windows

### 6.3 Notas sobre el Empaquetado

- ✅ Incluye todas las dependencias necesarias
- ✅ Incluye el código Arduino (pero debes subirlo manualmente)
- ✅ Incluye la configuración de base de datos
- ⚠️ **IMPORTANTE:** Después de instalar, aún necesitas:
  1. Subir el código Arduino al hardware
  2. Ejecutar `setup-database.bat` para configurar la BD
  3. Configurar XAMPP/MySQL

---

## Solución de Problemas

### Problema: Arduino no se conecta

**Síntomas:**
- Estado muestra "Desconectado"
- No responde a comandos

**Soluciones:**
1. ✅ Verificar que Arduino IDE esté cerrado (especialmente Monitor Serial)
2. ✅ Verificar puerto COM en Administrador de Dispositivos
3. ✅ Probar conectar manualmente desde Control Manual
4. ✅ Reiniciar Arduino (desconectar y conectar USB)
5. ✅ Verificar que el código esté subido correctamente

### Problema: Base de datos no conecta

**Síntomas:**
- Error al iniciar servidor
- Mensaje "Error de conexión con la base de datos"

**Soluciones:**
1. ✅ Verificar que XAMPP MySQL esté ejecutándose
2. ✅ Ejecutar `setup-database.bat` nuevamente
3. ✅ Verificar que el puerto 3306 esté disponible
4. ✅ Verificar credenciales en `server.js` (usuario: root, sin contraseña por defecto)

### Problema: Servidor no inicia

**Síntomas:**
- Error "Port 3000 already in use"
- Servidor no responde

**Soluciones:**
1. ✅ Cerrar otras instancias del servidor
2. ✅ Verificar que no haya otra aplicación usando el puerto 3000
3. ✅ Reiniciar terminal y volver a intentar

### Problema: Proceso no inicia en Arduino

**Síntomas:**
- Proceso se inicia en la web pero Arduino no ejecuta
- No se ven mensajes en Monitor Serial

**Soluciones:**
1. ✅ Verificar que Arduino esté en modo automático (comando "2")
2. ✅ Verificar conexión serial (Monitor Serial cerrado)
3. ✅ Revisar logs del servidor: `logs/silar-system.log`
4. ✅ Probar comando manual desde Monitor Serial:
   ```
   START_RECIPE:{"cycles":1,"dippingWait0":1000,"dippingWait1":1000,"dippingWait2":1000,"dippingWait3":1000,"transferWait":500,"fan":false}
   ```

### Problema: Timer se comporta raro

**Síntomas:**
- Timer muestra valores incorrectos
- Múltiples timers ejecutándose

**Soluciones:**
1. ✅ Asegúrate de usar la versión más reciente del código
2. ✅ Limpia caché del navegador (Ctrl+Shift+Delete)
3. ✅ Recarga la página completamente (Ctrl+F5)
4. ✅ Verifica que solo haya un proceso activo en la BD

---

## Verificación Final

Antes de usar el sistema en producción, verifica:

- [ ] ✅ Arduino conectado y respondiendo
- [ ] ✅ Base de datos configurada correctamente
- [ ] ✅ Servidor iniciado sin errores
- [ ] ✅ Login funcionando
- [ ] ✅ Comandos manuales funcionando (HOME, movimiento)
- [ ] ✅ Proceso automático ejecutándose correctamente
- [ ] ✅ Posiciones Y calibradas según hardware real
- [ ] ✅ Paro de emergencia funcionando
- [ ] ✅ Límites funcionando correctamente
- [ ] ✅ Lámpara y ventilador funcionando (si aplica)

---

## Comandos Útiles

```bash
# Iniciar servidor web
npm run web

# Iniciar aplicación Electron
npm run dev

# Configurar base de datos
npm run setup-db

# Actualizar esquema de BD
npm run update-db

# Empaquetar aplicación
npm run build

# Probar conexión Arduino
npm run arduino-test

# Ver logs del sistema
# Windows PowerShell:
Get-Content logs\silar-system.log -Tail 50 -Wait

# Windows CMD:
type logs\silar-system.log
```

---

## Contacto y Soporte

Para problemas o preguntas:
1. Revisa los logs: `logs/silar-system.log`
2. Revisa la consola del navegador (F12)
3. Revisa el Monitor Serial del Arduino (9600 baud)

---

## Documentación Adicional

- **Arduino:** `src/arduino/README.md`
- **API:** `docs/api/arduino-api.md`
- **Diagrama Eléctrico:** MOC-ELEC-001 REV 2/3

---

**Última actualización:** Noviembre 2024
**Versión del Sistema:** 2.0.0

