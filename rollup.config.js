export default [
    {
        input: 'src/tutorial.js',
        sourcemap: true,
        output: {
            file: 'dist/tutorial.js',
            format: 'iife'
        }
    },

    {
        input: 'src/backends/gpu-wires-decoder.worker.js',
        sourcemap: true,
        output: {
            file: 'dist/gpu-wires-decoder.worker.js',
            format: 'iife'
        }
    }
]
