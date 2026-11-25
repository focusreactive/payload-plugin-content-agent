title: Variables de entorno

Las variables de entorno conectan {{short}} Starter con su base de datos, protegen las sesiones de Payload e indican al sitio qué URL pública utilizar. Mantén los valores locales en la raíz del proyecto y configura los valores de producción en tu plataforma de alojamiento. El starter lee esta configuración en el servidor, excepto las variables con el prefijo `NEXT_PUBLIC_`, que [Next.js](https://nextjs.org) puede incluir en el código del navegador.

## Antes de empezar

Completa los [pasos de instalación]({{site}}/docs/getting-started/installation/) y crea un proyecto con `npx create-headless-starter`. Los ejemplos de esta página suponen que elegiste npm y que trabajas en el directorio del proyecto generado.

El starter utiliza PostgreSQL para su base de datos de [Payload](https://payloadcms.com). Ten preparada una base de datos local antes de iniciar la aplicación. El siguiente ejemplo supone que tienes una base de datos llamada `starter` y un usuario local llamado `starter` con acceso a ella. Cambia la cadena de conexión si tu base de datos utiliza otras credenciales, otro puerto o un servicio alojado.

También necesitas OpenSSL para generar un secreto durante la configuración que se describe a continuación. Si no está disponible en tu equipo, genera un valor aleatorio criptográficamente seguro con otra herramienta y agrégalo al archivo por tu cuenta.

## Crea tu archivo de entorno local

1. Comprueba si el proyecto ya tiene un archivo `.env`. Si existe, edítalo en lugar de ejecutar el siguiente comando, que lo sobrescribiría.
2. Desde la raíz del proyecto, crea `.env` con la configuración de la base de datos local y un secreto recién generado:

   ```bash
   cat > .env <<EOF
   DATABASE_URI=postgresql://starter:starter@localhost:5432/starter
   PAYLOAD_SECRET=$(openssl rand -hex 32)
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   EOF
   ```

3. Comprueba que la cadena de conexión coincida con tu instancia de PostgreSQL. Si ya tenías un archivo `.env`, agrega las variables que falten y genera un secreto único con `openssl rand -hex 32`.
4. Inicia la aplicación y visita la URL local que aparece en la terminal:

   ```bash
   npm run dev
   ```

El archivo `.env` contiene configuración local; no es una fuente de credenciales compartida. El proyecto generado está configurado para que Git lo ignore. Reinicia el servidor de desarrollo después de cambiar un valor para que la aplicación lea la configuración actualizada.

> **Nota:** Usa un `PAYLOAD_SECRET` diferente para cada entorno. Cambiar el secreto de un entorno existente puede invalidar las sesiones de Payload, así que planifica el cambio para un momento en que los usuarios puedan volver a iniciar sesión.

## Variables disponibles

El starter lee las siguientes variables. Los valores obligatorios deben configurarse en todos los entornos donde se ejecute la aplicación.

| Variable | Obligatoria | Propósito |
| --- | --- | --- |
| `DATABASE_URI` | Sí | Cadena de conexión de PostgreSQL utilizada por el adaptador de base de datos de Payload. |
| `PAYLOAD_SECRET` | Sí | Secreto que Payload utiliza para operaciones sensibles desde el punto de vista de la seguridad. Genera un valor aleatorio largo. |
| `NEXT_PUBLIC_SITE_URL` | Sí | Origen público que utiliza el starter para construir las URL absolutas del sitio. |
| `NEXT_TELEMETRY_DISABLED` | No | Establece el valor en `1` para desactivar la telemetría anónima de Next.js. |

Para el trabajo local, `NEXT_PUBLIC_SITE_URL` debe coincidir con el origen que utilizas para acceder al sitio. En producción, establécelo como el origen público canónico, incluido el protocolo y sin una barra final. No incluyas la ruta de una página.

El URI de la base de datos y el secreto de Payload deben permanecer exclusivamente en el servidor. Nunca agregues el prefijo `NEXT_PUBLIC_` a ninguna de estas variables, las incluyas en un bloque de página ni las copies en el contenido. Los bloques de `src/blocks/` pueden utilizar la configuración pública cuando sea necesario; consulta los [bloques disponibles]({{site}}/docs/reference/blocks/) para conocer sus campos de contenido.

## Cómo se utiliza la URL del sitio

El archivo `starter.config.ts` generado pone la URL pública del sitio a disposición de la configuración del sitio del starter:

```ts
const starterConfig = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
}

export default starterConfig
```

El valor predeterminado facilita el desarrollo local, pero las compilaciones de producción siempre deben recibir un valor explícito. El starter utiliza `siteUrl` cuando necesita un origen absoluto, por ejemplo, para los metadatos. Configura la URL pública antes de compilar y luego comprueba los metadatos generados como se describe en la [guía de metadatos SEO]({{site}}/docs/guides/seo-metadata/).

Next.js incorpora los valores de `NEXT_PUBLIC_` al código del cliente durante la compilación. Si cambias `NEXT_PUBLIC_SITE_URL` después de una compilación de producción, vuelve a compilar la aplicación antes de desplegarla de nuevo. Es una configuración pública, no un lugar para guardar credenciales.

## Despliegue y solución de problemas

Configura los mismos nombres de variables obligatorias en la configuración de entorno de tu plataforma de alojamiento. Usa el URI de la base de datos de producción, un secreto de Payload generado por separado y el origen del sitio de producción. Proporciona los valores tanto para la compilación como para la aplicación en ejecución, y mantén el secreto de producción fuera de los registros, commits y scripts de despliegue.

Si la aplicación no puede conectarse a la base de datos, comprueba que PostgreSQL esté en ejecución, que las credenciales sean correctas y que la base de datos acepte conexiones desde el entorno de la aplicación. Que una conexión funcione en tu equipo portátil no garantiza que una aplicación alojada pueda acceder a la misma base de datos.

Si los enlaces o metadatos contienen el origen local después del despliegue, comprueba el valor de `NEXT_PUBLIC_SITE_URL` utilizado para la compilación y vuelve a compilar con el valor correcto. Si un cambio en la configuración local no parece tener efecto, reinicia el servidor de desarrollo y comprueba si hay un archivo de entorno con mayor prioridad o una variable ya configurada en tu shell.
