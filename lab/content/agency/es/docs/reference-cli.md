title: Referencia de la CLI

La CLI de {{short}} Starter crea un proyecto App Router de [Next.js](https://nextjs.org) con [Payload](https://payloadcms.com), TypeScript y una biblioteca de bloques de página. Úsala para crear la estructura inicial de un proyecto o agregar un bloque a un starter existente. Para conocer los requisitos previos y realizar la configuración inicial, consulta la guía para [instalar el starter]({{site}}/docs/getting-started/installation/).

## Uso

Ejecuta la CLI con `npx create-headless-starter` seguido de un comando. El comando `init` crea un proyecto en un directorio nuevo; `add-block` genera archivos dentro de un proyecto existente. Ejecuta `add-block` desde la raíz del proyecto, donde se encuentra `starter.config.ts`.

```bash
npx create-headless-starter init my-site --package-manager npm --skip-install
cd my-site
npm install
npm run dev
```

El primer comando crea `my-site` sin instalar dependencias. Los demás comandos acceden al directorio, instalan las dependencias e inician el servidor de desarrollo. Omite `--skip-install` para que la CLI instale las dependencias al crear el proyecto.

Ejecuta la CLI sin ningún comando para ver los comandos disponibles. Agrega `--help` después de un comando para ver sus argumentos y opciones. El comando `init` requiere un nombre de directorio y `add-block` requiere un nombre de bloque.

La CLI no sobrescribe un directorio de proyecto existente durante la inicialización. Elige un nombre de destino que no esté en uso o mueve el directorio existente antes de volver a ejecutar `init`.

## Opciones

Las opciones se colocan después del comando y su argumento obligatorio. La CLI informa de las opciones desconocidas en lugar de ignorarlas.

| Opción | Comandos | Efecto |
| --- | --- | --- |
| `--package-manager <name>` | `init` | Selecciona `npm`, `pnpm` o `yarn` para instalar las dependencias y generar las instrucciones. Por defecto, usa `npm`. |
| `--skip-install` | `init` | Crea los archivos del proyecto sin instalar dependencias. |
| `--dry-run` | `add-block` | Muestra los archivos que el comando crearía o reemplazaría, sin escribirlos. |
| `--force` | `add-block` | Reemplaza los archivos generados que ya existen en el destino. |
| `--help` | Todos los comandos | Muestra las instrucciones de uso del comando sin modificar archivos. |

El gestor de paquetes seleccionado debe estar disponible en tu equipo si la instalación está habilitada. Con `--skip-install`, la selección también se guarda en `starter.config.ts` para usarla en las instrucciones que muestra la CLI.

`--force` solo se aplica a los archivos generados para el bloque indicado. No registra el bloque ni actualiza otros archivos del proyecto. Si no estás seguro de qué archivos se reemplazarían, primero revisa el resultado de una ejecución de prueba.

## Configuración

La CLI crea `starter.config.ts` en la raíz del proyecto durante la inicialización. Lee este archivo cuando ejecutas `add-block`. Una configuración predeterminada tiene este aspecto:

```ts
export default {
  blocksDir: 'src/blocks',
  packageManager: 'npm',
} as const
```

`blocksDir` es la ruta, relativa a la raíz del proyecto, donde se generan los directorios de los bloques. Mantenla dentro del proyecto. Los cambios afectan a las generaciones posteriores; la CLI no mueve los bloques que ya existen.

`packageManager` registra el gestor de paquetes del proyecto. Configúralo como `npm`, `pnpm` o `yarn` si cambias de herramienta después de la inicialización. Afecta a las instrucciones que muestra la CLI, no al contenido del archivo de bloqueo. Actualiza las dependencias y el archivo de bloqueo por separado cuando cambies de gestor de paquetes.

Si falta el archivo de configuración o contiene un valor no admitido, `add-block` se detiene sin escribir archivos. Corrige el archivo y vuelve a ejecutar el comando.

## Agregar un bloque

Usa `add-block` para crear la configuración de un bloque de Payload y el componente correspondiente del frontend. Los nombres de los bloques deben comenzar con una letra y contener solo letras y números. Usa un nombre descriptivo como `Callout`; la CLI lo utiliza para el directorio generado y los identificadores de TypeScript.

```bash
npx create-headless-starter add-block Callout --dry-run
npx create-headless-starter add-block Callout
```

El primer comando muestra una vista previa del resultado. El segundo escribe `src/blocks/Callout/config.ts` y `src/blocks/Callout/Component.tsx`, suponiendo que se use el valor predeterminado de `blocksDir`.

1. Ejecuta el comando de prueba y revisa las rutas de destino.
2. Ejecuta el comando sin `--dry-run` para crear los archivos.
3. Agrega la configuración generada del bloque de Payload al campo de diseño de página.
4. Agrega el componente al renderizador de bloques del frontend, inicia el proyecto y prueba el bloque en una página.

Los archivos generados son un punto de partida, no un bloque de página completamente registrado. Edita los campos de Payload y el componente de forma coordinada para que el componente use los datos que pueden introducir los editores.

> **Nota:** Si alguno de los archivos generados ya existe, el comando se detiene sin modificar ninguno de los dos. Usa `--force` solo cuando quieras reemplazar ambos archivos generados.

## Códigos de salida y configuración relacionada

Un comando ejecutado correctamente finaliza con el código `0`. Los argumentos no válidos, los errores de configuración, los archivos de destino existentes y los errores al instalar dependencias producen un código de salida distinto de cero. En los scripts automatizados, comprueba el código de salida antes de ejecutar comandos que dependan del proyecto generado.

La CLI no configura redirecciones ni modifica las reglas de acceso a la API. Después de crear un proyecto, puedes [configurar las redirecciones]({{site}}/docs/guides/redirects/) por separado y consultar la guía para [acceder al contenido a través de la API REST]({{site}}/docs/reference/rest-api/) al integrar un cliente.
