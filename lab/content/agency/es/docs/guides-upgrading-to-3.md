title: Actualización de 2.x a 3.x

{{short}} Starter 3.x reorganiza la configuración y el registro de bloques, manteniendo Next.js App Router y Payload CMS como pilares del proyecto. Esta guía explica cómo actualizar un sitio existente de 2.x, incluidos su contenido y sus bloques personalizados. Trabaja en una rama y realiza las pruebas con una copia de la base de datos de producción antes de desplegar.

## Antes de comenzar

Anota las versiones de [Next.js](https://nextjs.org) y [Payload](https://payloadcms.com) que utiliza tu proyecto actual. El starter 3.x puede incluir versiones más recientes de ambos, así que revisa sus requisitos de actualización junto con los cambios del starter. No des por hecho que actualizar solo el starter actualizará el código de tu aplicación o el esquema de la base de datos.

Haz copias de seguridad de la base de datos y de los archivos multimedia subidos por separado. Una copia de seguridad de la base de datos puede contener referencias a archivos sin incluir los archivos en sí. Conserva una copia del archivo de bloqueo y de la configuración de 2.x para poder reproducir la compilación anterior si necesitas revertir la actualización.

> **Nota:** No ejecutes comandos de migración en producción durante la actualización inicial. Genera y revisa las migraciones localmente y, después, pruébalas en una base de datos restaurada antes de programar el despliegue.

## Crea un proyecto 3.x limpio

Usa un starter recién creado como referencia para los archivos generados y las dependencias. La CLI te pedirá un directorio para el proyecto:

```bash
npx create-headless-starter
```

Elige un directorio vacío en lugar de tu repositorio actual. Después, sigue estos pasos:

1. Compara el `package.json` y el archivo de bloqueo generados con tus versiones de 2.x. Incorpora los cambios en las dependencias y conserva los paquetes que tu aplicación aún necesita.
2. Compara los archivos de configuración de App Router y Payload generados con los tuyos. Conserva las rutas personalizadas, las reglas de acceso, las colecciones y los plugins.
3. Adapta la configuración de tu starter a la estructura de 3.x descrita a continuación. Elimina las claves antiguas después de comprobar dónde se utilizan.
4. Actualiza las definiciones de bloques personalizados y sus registros de renderizado. Conserva los slugs de bloque existentes, a menos que hayas planificado una migración de contenido.
5. Compila y prueba el proyecto con una base de datos restaurada y una copia de tus archivos multimedia. Revisa las migraciones de esquema antes de aplicarlas al entorno de pruebas.

Incorpora los cambios de forma selectiva. Reemplazar todo el directorio de la aplicación puede eliminar funcionalidades específicas del proyecto, como redirecciones, autenticación y flujos de trabajo editorial.

## Actualiza la configuración del starter

En 3.x, `starter.config.ts` agrupa las opciones relacionadas en lugar de mantenerlas en el nivel superior. El siguiente ejemplo habilita dos bloques y usa la URL del sitio definida en el entorno:

```ts
const config = {
  site: {
    url: process.env.NEXT_PUBLIC_SITE_URL!,
  },
  api: {
    basePath: '/api',
  },
  blocks: ['hero', 'richText'],
  images: {
    remoteHosts: [],
  },
}

export default config
```

Define `NEXT_PUBLIC_SITE_URL` en cada entorno de despliegue antes de compilar. Compara los valores requeridos por el proyecto generado con tus secretos actuales y consulta la guía sobre [cómo configurar variables para cada entorno]({{site}}/docs/getting-started/environment-variables/). No incluyas secretos en el repositorio.

| Campo de 2.x | Campo de 3.x | Acción de actualización |
| --- | --- | --- |
| `siteUrl` | `site.url` | Mueve la URL pública del sitio a `site`. |
| `apiPath` | `api.basePath` | Conserva la ruta actual de la API si hay clientes que dependen de ella. |
| `enabledBlocks` | `blocks` | Mueve la lista de slugs de los bloques habilitados. |
| `imageHosts` | `images.remoteHosts` | Mueve los nombres de host permitidos para imágenes remotas a `images`. |

Una lista `images.remoteHosts` vacía no permite ningún host de imágenes remotas. Añade solo los hosts que necesita tu sitio y revisa también la configuración de imágenes generada por Next.js. Para obtener información sobre el manejo de archivos subidos y recursos remotos, consulta [cómo trabajar con imágenes]({{site}}/docs/guides/image-handling/).

## Mueve y registra los bloques

En 3.x, los bloques se encuentran en `src/blocks/`. El proyecto generado agrupa la definición de Payload y el componente de React de cada bloque, y sitúa el registro de renderizado en `src/blocks/index.tsx`. Compara ese registro con el renderizador de bloques de 2.x y añade una entrada para cada bloque personalizado que puedan usar los editores.

El arreglo `blocks` de `starter.config.ts` controla qué bloques registrados del starter están habilitados; añadir un slug no crea sus campos de Payload ni su componente de React. Traslada ambas partes de cada bloque personalizado y actualiza las importaciones para que apunten a sus nuevas ubicaciones. Revisa también las definiciones de campos compartidos y los tipos generados de Payload.

Siempre que sea posible, mantén sin cambios los slugs y los nombres de campo almacenados. Cambiar el nombre de un archivo de componente no es lo mismo que cambiar el slug de un bloque de Payload: los documentos existentes contienen el slug almacenado, y un renderizador que solo reconozca el nuevo valor no podrá mostrar el contenido anterior. Si es necesario cambiar el esquema, escribe y prueba una migración de datos antes de dejar de admitir la estructura anterior.

## Verifica la actualización

Instala las dependencias con el gestor de paquetes y el archivo de bloqueo que hayas elegido. Después, ejecuta una compilación de producción e inicia el servidor de desarrollo. Para un proyecto que utiliza npm:

```bash
npm install
npm run build
npm run dev
```

Abre páginas representativas que contengan cada bloque, incluidas páginas con campos opcionales vacíos. Prueba la edición y publicación en Payload, la vista previa, las redirecciones y la carga de archivos multimedia. Compara las páginas renderizadas con las del sitio 2.x, en lugar de confiar únicamente en que la compilación haya finalizado correctamente.

Revisa las integraciones que leen o escriben contenido a través de la API. Confirma sus rutas, autenticación y estructuras de campo esperadas con ayuda de los [detalles de solicitudes y respuestas]({{site}}/docs/reference/rest-api/). Un cambio en el esquema de un bloque puede afectar a quienes consumen la API, aunque su ruta base siga siendo la misma.

Una vez que el entorno de pruebas supere estas verificaciones, despliega la aplicación y las migraciones de base de datos revisadas al mismo tiempo. Conserva las copias de seguridad de la base de datos y de los archivos multimedia hasta que se haya verificado la nueva versión, y mantén la compilación de 2.x para poder restaurarla si es necesario revertir el despliegue.
