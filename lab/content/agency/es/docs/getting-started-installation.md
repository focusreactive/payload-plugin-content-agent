title: Instalación

Instala {{short}} Starter para ejecutar un sitio con Next.js App Router y Payload CMS desde un único proyecto TypeScript. El starter incluye una colección de páginas, un editor de páginas basado en bloques y los componentes que renderizan esos bloques. Esta guía te acompaña desde un directorio vacío hasta un sitio local con tu primera cuenta de administrador.

## Antes de comenzar

Necesitas Node.js 22 LTS, npm y acceso a una base de datos PostgreSQL 15 o posterior. La base de datos puede ejecutarse en tu equipo o en un servidor de desarrollo. Ten a mano su cadena de conexión y usa una base de datos dedicada a este proyecto: el starter crea sus propias tablas durante el desarrollo.

También debes saber ejecutar comandos en una terminal y editar variables de entorno. La aplicación generada usa [Next.js](https://nextjs.org) para el enrutamiento y la renderización, y [Payload](https://payloadcms.com) para la interfaz de administración y la API de contenido.

## Crear el proyecto

1. Ejecuta la CLI desde el directorio en el que quieras crear la carpeta del proyecto. El comando genera los archivos, pero deberás instalar las dependencias por separado.

   ```bash
   npx create-headless-starter my-site
   cd my-site
   npm install
   cp .env.example .env
   ```

   El directorio generado `my-site` contiene la aplicación, la configuración de Payload y los ajustes del starter. Si lo prefieres, usa otro nombre de directorio en el primer comando; los demás comandos deben ejecutarse desde ese directorio.

2. Abre `.env` y asigna a `DATABASE_URI` la cadena de conexión de PostgreSQL. Asigna a `PAYLOAD_SECRET` un valor largo y aleatorio. Puedes generar uno con:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Copia el resultado en `PAYLOAD_SECRET`. No incluyas `.env` en el control de versiones y usa un secreto diferente para cada entorno desplegado.

3. Ejecuta `npm run dev`. En la primera ejecución, el adaptador de base de datos de desarrollo crea las tablas que necesitan las colecciones generadas. La terminal muestra la dirección local cuando el servidor está listo.

4. Abre la dirección local que aparece en la terminal y visita la ruta `/admin`. Crea la primera cuenta de administrador cuando se te solicite. Después, crea una página, añade un bloque y guárdala para confirmar que el editor y la base de datos funcionan.

> **Nota:** Las actualizaciones automáticas del esquema solo están habilitadas para el desarrollo local. Considera la base de datos de desarrollo como desechable y usa migraciones de base de datos revisadas al desplegar cambios en un entorno existente.

## Configurar el starter

El proyecto lee `starter.config.ts` al generar la configuración de Payload y el renderizador de páginas. Comienza con los valores predeterminados y después cambia el nombre del sitio o los bloques disponibles para los editores.

```ts
import { defineStarterConfig } from './src/starter/defineStarterConfig'

export default defineStarterConfig({
  siteName: 'Editorial',
  defaultLocale: 'en',
  blocks: ['hero', 'richText', 'callToAction'],
})
```

| Opción | Función | Valor predeterminado |
| --- | --- | --- |
| `siteName` | Nombre utilizado en la interfaz de administración y en los metadatos predeterminados de las páginas. | `Editorial` |
| `defaultLocale` | Configuración regional utilizada para el contenido y los atributos de idioma HTML. | `en` |
| `blocks` | Tipos de bloques disponibles en el editor de páginas. | `hero`, `richText`, `callToAction` |
| `navigationDepth` | Número máximo de niveles de navegación anidados en el editor de administración. | `2` |

Reinicia el servidor de desarrollo después de modificar este archivo para que el esquema de administración y el renderizador usen la misma configuración. Cambiar `blocks` determina qué bloques registrados pueden añadir los editores, pero no elimina los datos de bloques que ya están guardados en la base de datos. Antes de eliminar un tipo de bloque, actualiza las páginas que lo usan y comprueba cómo se renderizan.

## Trabajar con bloques de página

Las definiciones de bloques y sus componentes React se encuentran en `src/blocks/`. Cada bloque tiene una definición de Payload para sus campos y un componente que renderiza los datos guardados. Por ejemplo, el bloque `hero` generado contiene un encabezado y campos de enlace opcionales, mientras que `richText` está pensado para contenido editorial más extenso.

La colección de páginas almacena los bloques en un campo de diseño ordenado. Los editores pueden añadirlos, reordenarlos y eliminarlos en Payload; la página de App Router lee ese diseño y renderiza los componentes correspondientes en orden. Una página recién creada no tendrá un diseño útil hasta que un editor añada contenido.

Para añadir un bloque, crea su definición y su componente en `src/blocks/`, regístralo en el registro de bloques generado y añade su clave al arreglo `blocks` en `starter.config.ts`. Usa la misma clave de registro en la configuración y en el renderizador. Después de reiniciar el servidor, comprueba el bloque en el editor de administración y en una página publicada.

## Comprobar la instalación

Crea una página con un slug y al menos un bloque, y después publícala. Visita la ruta correspondiente en el sitio local y confirma que aparece el contenido. Si la interfaz de administración carga, pero no puedes guardar, revisa la salida de la terminal y verifica que `DATABASE_URI` apunte a una base de datos en la que tu usuario tenga permisos de escritura.

Si el servidor falla antes de estar listo, comprueba la versión de Node.js y confirma que las dos variables de entorno obligatorias estén configuradas. Después de editar `.env`, detén y reinicia `npm run dev`; los cambios en las variables de entorno del servidor no se aplican a un proceso que ya está en ejecución.

## Próximos pasos

Cuando el sitio local funcione, sigue la guía para [preparar tu primer despliegue]({{site}}/docs/getting-started/first-deploy/), incluidas las comprobaciones del entorno y las migraciones. Para ofrecer contenido en otro idioma, aprende a [añadir una configuración regional]({{site}}/docs/recipes/add-a-locale/). Si vas a actualizar un proyecto 2.x existente en lugar de empezar desde cero, lee las instrucciones para [actualizar a la versión 3]({{site}}/docs/guides/upgrading-to-3/).
