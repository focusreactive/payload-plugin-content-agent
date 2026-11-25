title: Primer despliegue

Al desplegar {{short}} Starter, tu sitio de [Next.js](https://nextjs.org) y el panel de administración de [Payload](https://payloadcms.com) funcionan en la misma aplicación. Esta guía utiliza PostgreSQL para el contenido y almacenamiento de objetos compatible con S3 para los archivos subidos, de modo que ambos se conserven cuando se reinicie la aplicación. Crearás un proyecto, configurarás su entorno de producción, ejecutarás las migraciones de la base de datos y publicarás la aplicación en un servicio de alojamiento compatible con Node.js.

## Crear el proyecto

Genera un proyecto con los adaptadores de PostgreSQL y de almacenamiento S3 seleccionados:

```bash
npx create-headless-starter my-site --database postgres --storage s3
cd my-site
npm install
```

El comando crea un proyecto de TypeScript con Next.js App Router, la configuración de Payload y un conjunto de bloques de página en `src/blocks/`. También incluye la migración inicial de la base de datos. Confirma los archivos generados en tu repositorio, incluidos los archivos de migración, antes de conectarlo a un servicio de alojamiento.

El proyecto inicial incluye una colección de páginas y un campo de diseño basado en bloques. Los editores pueden crear páginas con los bloques incluidos; consulta los [campos de bloque disponibles]({{site}}/docs/reference/blocks/) antes de modificar la estructura de las páginas.

## Configurar la aplicación

Abre `starter.config.ts` y establece las opciones de producción. Este ejemplo obtiene el origen público del sitio de una variable de entorno y habilita el adaptador de almacenamiento seleccionado durante la configuración.

```ts
import { defineStarterConfig } from './src/starter'

export default defineStarterConfig({
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  database: 'postgres',
  media: {
    adapter: 's3',
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION,
  },
})
```

Usa el origen público del sitio desplegado para `NEXT_PUBLIC_SITE_URL`, sin una barra al final. El proyecto inicial lo utiliza para generar URL absolutas. En un entorno de vista previa, establece el origen de vista previa; en producción, establece el origen de producción.

No guardes credenciales en `starter.config.ts` ni en tu repositorio. El adaptador generado obtiene las credenciales de la base de datos y del almacenamiento desde el entorno durante la ejecución.

## Definir las variables de entorno

Crea una base de datos PostgreSQL y un bucket compatible con S3 antes del despliegue. Concede a las credenciales de almacenamiento acceso a ese bucket y configura el acceso público de lectura a los archivos multimedia publicados a través de tu proveedor de almacenamiento. La aplicación necesita una URL pública estable para los archivos multimedia, de modo que los navegadores puedan cargar las imágenes.

Añade estas variables al entorno de producción de tu proveedor de alojamiento:

| Variable | Finalidad |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Origen público utilizado para las URL absolutas del sitio |
| `DATABASE_URI` | Cadena de conexión de PostgreSQL, incluido el nombre de la base de datos |
| `PAYLOAD_SECRET` | Clave secreta larga y aleatoria que Payload utiliza para firmar tokens |
| `S3_BUCKET` | Nombre del bucket para los archivos multimedia subidos |
| `S3_REGION` | Región utilizada por el adaptador de almacenamiento |
| `S3_ENDPOINT` | Punto de acceso de la API compatible con S3; omítelo si usas Amazon S3 |
| `S3_ACCESS_KEY_ID` | Clave de acceso al bucket |
| `S3_SECRET_ACCESS_KEY` | Clave secreta asociada a la clave de acceso |
| `S3_PUBLIC_URL` | URL base pública desde la que se sirven los archivos subidos |

Genera un `PAYLOAD_SECRET` único de al menos 32 caracteres para cada entorno. Asegúrate de que el servicio de alojamiento pueda conectarse a la base de datos y al punto de acceso del almacenamiento, y configura las listas de acceso de red que exijan tus proveedores.

> **Nota:** Usa una base de datos y un bucket independientes para las vistas previas. Ejecutar una vista previa con recursos de producción puede modificar el contenido publicado o sobrescribir archivos multimedia.

## Desplegar e inicializar

Elige un servicio de alojamiento compatible con Node.js que pueda ejecutar una aplicación Next.js, proporcionar las variables de entorno anteriores y ejecutar un comando de publicación. El proceso de la aplicación debe poder conectarse a PostgreSQL y al servicio de almacenamiento.

1. Conecta tu repositorio al servicio de alojamiento y selecciona la rama que quieres desplegar.
2. Añade las variables de entorno de producción al servicio de alojamiento. Asegúrate de que estén disponibles tanto durante la compilación como durante la ejecución de la aplicación.
3. Configura el proceso de publicación para ejecutar las migraciones de Payload confirmadas en el repositorio sobre la base de datos de producción antes de poner en servicio la nueva versión.
4. Compila la aplicación e iníciala con la configuración del proceso de Node.js del servicio de alojamiento.
5. Abre `/admin` en el sitio desplegado y crea el primer usuario administrador. Hazlo lo antes posible: una instalación nueva permite crear el primer usuario desde la pantalla de administración.

El proyecto generado proporciona los siguientes comandos. Ejecuta la migración con las variables de entorno de producción como parte de un paso de publicación controlado; no la ejecutes desde una terminal de desarrollo que pueda estar conectada a una base de datos no prevista.

```bash
npm run payload -- migrate
npm run build
npm run start
```

Para los cambios posteriores en el esquema, genera y confirma una migración en el repositorio durante el desarrollo y, después, aplícala en el paso de publicación antes de que se inicie la aplicación actualizada. Haz una copia de seguridad de la base de datos de producción antes de aplicar migraciones a un sitio existente.

## Comprobar el sitio publicado

En el panel de administración, crea una página, añade un bloque y publícala. Abre la página correspondiente en el sitio público y confirma que se muestra su contenido. Sube una imagen, añádela a la página y comprueba que se cargue en un navegador; así verificarás tanto la configuración del bucket como la aplicación.

Si la compilación falla, comprueba que las variables de entorno estén disponibles durante la compilación y no solo durante la ejecución. Si el sitio se inicia pero falta contenido, comprueba la conexión a la base de datos y los resultados de la migración. Si faltan imágenes, comprueba los permisos del bucket y `S3_PUBLIC_URL`.

Cuando la primera página funcione, puedes [configurar idiomas y regiones]({{site}}/docs/guides/localization/) para crear un sitio multilingüe o [proteger una página con contraseña]({{site}}/docs/recipes/protect-a-page/) antes de compartir contenido restringido.
