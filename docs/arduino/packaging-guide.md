# Guía de Empaquetado y Arduino - SILAR System

## ✅ Respuesta Rápida

**Sí, después del empaquetado el Arduino debería funcionar**, siempre que se cumplan los siguientes requisitos:

## 📋 Requisitos Previos

### 1. Node.js en el Sistema Destino
El servidor Node.js necesita estar instalado en el sistema donde se ejecutará la aplicación empaquetada, ya que:
- El servidor se ejecuta como proceso separado usando `node server.js`
- `serialport` requiere Node.js para funcionar

### 2. Módulos Nativos Compilados
- `serialport` incluye módulos nativos que deben compilarse para la arquitectura correcta
- En Windows, esto requiere herramientas de compilación de C++

### 3. Base de Datos MySQL
- MySQL/XAMPP debe estar instalado y ejecutándose
- La base de datos `silar_db` debe estar creada

## 🔧 Configuración del Empaquetado

### Archivos Incluidos
El `package.json` está configurado para incluir:
- ✅ `server.js` - Servidor Node.js principal
- ✅ `src/**/*` - Todo el código fuente
- ✅ `config/**/*` - Archivos de configuración
- ✅ `node_modules/**/*` - Todas las dependencias (incluyendo serialport)
- ✅ Módulos nativos de serialport descomprimidos (`asarUnpack`)

### Configuración Especial para Serialport
```json
"asar": false,  // Desactiva ASAR para permitir acceso a módulos nativos
"asarUnpack": [
  "**/node_modules/@serialport/**/*",
  "**/node_modules/serialport/**/*"
]
```

## 🚀 Proceso de Empaquetado

### 1. Instalar Dependencias
```bash
npm install
```

### 2. Compilar Módulos Nativos
Asegúrate de que `serialport` esté compilado correctamente:
```bash
npm rebuild serialport
```

### 3. Empaquetar la Aplicación
```bash
npm run build
```

Esto generará un instalador en `dist/SILAR-System-Setup-2.0.0.exe`

## 📦 Instalación en el Sistema Destino

### Requisitos del Sistema
1. **Windows 10/11** (64-bit)
2. **Node.js** instalado (versión 18 o superior recomendada)
3. **MySQL/XAMPP** instalado y ejecutándose
4. **Arduino conectado** al puerto USB

### Pasos de Instalación
1. Ejecutar `SILAR-System-Setup-2.0.0.exe`
2. Seguir el asistente de instalación
3. La aplicación se instalará en la carpeta seleccionada

## 🔌 Funcionamiento del Arduino

### Inicio Automático
Cuando se ejecuta la aplicación empaquetada:
1. ✅ Electron inicia la ventana principal
2. ✅ Automáticamente inicia el servidor Node.js (`server.js`)
3. ✅ El servidor carga `ArduinoController.js`
4. ✅ `serialport` se conecta al Arduino

### Detección Automática
El sistema intenta detectar automáticamente el puerto Arduino:
- Escanea todos los puertos COM disponibles
- Identifica Arduino por Vendor ID / Product ID
- Se conecta automáticamente si encuentra uno

### Conexión Manual
Si la detección automática falla:
1. Ir a la pantalla de "Configuración"
2. Ver lista de puertos disponibles
3. Seleccionar el puerto correcto (ej: COM3, COM5)
4. Hacer clic en "Conectar"

## ⚠️ Solución de Problemas

### Problema: "No se puede encontrar el módulo serialport"
**Solución:**
- Verificar que Node.js esté instalado
- Reinstalar dependencias: `npm install`
- Recompilar módulos nativos: `npm rebuild serialport`

### Problema: "Error al conectar con Arduino"
**Solución:**
- Verificar que el Arduino esté conectado por USB
- Verificar que ningún otro programa esté usando el puerto
- Verificar que el sketch correcto esté cargado en el Arduino

### Problema: "Servidor no se inicia"
**Solución:**
- Verificar que Node.js esté en el PATH del sistema
- Verificar permisos de ejecución
- Revisar logs en la consola de Electron (F12)

## 📝 Notas Importantes

1. **Node.js Requerido**: A diferencia de algunas aplicaciones Electron que empaquetan todo, esta aplicación requiere Node.js instalado porque el servidor se ejecuta como proceso separado.

2. **Módulos Nativos**: `serialport` requiere módulos nativos compilados específicos para cada plataforma. El empaquetado incluye los binarios necesarios.

3. **Puertos COM**: En Windows, los puertos Arduino aparecen como COM1, COM2, COM3, etc. El sistema detecta automáticamente el correcto.

4. **Permisos**: En algunos sistemas puede requerir permisos de administrador para acceder a puertos serie.

## ✅ Verificación Post-Instalación

Para verificar que todo funciona:

1. **Verificar Servidor**: La aplicación debería mostrar "MySQL: Conectado" en el header
2. **Verificar Arduino**: Debería mostrar "Arduino: Conectado" si está conectado
3. **Probar Conexión**: Ir a "Control Manual" y probar mover los ejes

## 🎯 Resumen

**Sí, el Arduino funcionará después del empaquetado** siempre que:
- ✅ Node.js esté instalado en el sistema destino
- ✅ MySQL esté ejecutándose
- ✅ El Arduino esté conectado
- ✅ Los módulos nativos se hayan compilado correctamente durante el empaquetado

La aplicación está configurada para iniciar automáticamente el servidor y conectarse al Arduino al iniciar.


