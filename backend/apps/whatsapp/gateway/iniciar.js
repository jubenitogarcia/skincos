#!/usr/bin/env node

const { exec } = require('child_process');
const path = require('path');

console.log('🤖 Iniciador de Bot WhatsApp');
console.log('===========================\n');

console.log('Escolha qual bot executar:');
console.log('1. Bot Básico (meu_bot.js) - Simples e fácil');
console.log('2. Bot Avançado (bot_avancado.js) - Mais funcionalidades');
console.log('3. Exemplo Oficial (example.js) - Todas as funcionalidades\n');

// Simular input do usuário (você pode alterar aqui)
const opcao = process.argv[2] || '1';

let arquivo;
switch (opcao) {
    case '1':
        arquivo = 'meu_bot.js';
        console.log('▶️ Iniciando Bot Básico...\n');
        break;
    case '2':
        arquivo = 'bot_avancado.js';
        console.log('▶️ Iniciando Bot Avançado...\n');
        break;
    case '3':
        arquivo = 'example.js';
        console.log('▶️ Iniciando Exemplo Oficial...\n');
        break;
    default:
        console.log('❌ Opção inválida! Usando Bot Básico por padrão...\n');
        arquivo = 'meu_bot.js';
}

// Executar o arquivo escolhido
const child = exec(`node ${arquivo}`, (error, stdout, stderr) => {
    if (error) {
        console.error(`❌ Erro: ${error}`);
        return;
    }
    if (stderr) {
        console.error(`⚠️ Aviso: ${stderr}`);
    }
    console.log(stdout);
});

// Repassar output em tempo real
child.stdout.on('data', (data) => {
    process.stdout.write(data);
});

child.stderr.on('data', (data) => {
    process.stderr.write(data);
});

child.on('close', (code) => {
    console.log(`\n🔚 Bot encerrado com código: ${code}`);
});
