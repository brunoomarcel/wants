const fs = require('fs');
const path = require('path');

function obterValor(vars, caminho) {
  return caminho.split('.').reduce((acc, chave) => (acc == null ? undefined : acc[chave]), vars);
}

function lerTemplate(nome) {
  return fs.readFileSync(path.join(__dirname, `${nome}.md`), 'utf-8');
}

function renderizar(texto, vars) {
  let resultado = texto.replace(
    /\{\{>\s*([\w.-]+)\s*\}\}/g,
    (_, nome) => renderizar(lerTemplate(nome), vars)
  );

  resultado = resultado.replace(
    /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, condicao, seVerdadeiro, seFalso) => (obterValor(vars, condicao) ? seVerdadeiro : seFalso)
  );

  resultado = resultado.replace(
    /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, condicao, seVerdadeiro) => (obterValor(vars, condicao) ? seVerdadeiro : '')
  );

  return resultado.replace(/\{\{([\w.]+)\}\}/g, (_, caminho) => {
    const valor = obterValor(vars, caminho);
    return valor == null ? '' : String(valor);
  });
}

function carregarPrompt(nome, vars = {}) {
  return renderizar(lerTemplate(nome), vars).trim();
}

function buildSystemPrompt({ usuario, hasHistory }) {
  return carregarPrompt('system', {
    usuario,
    hasHistory,
    dataAtual: new Date().toLocaleDateString('pt-BR')
  });
}

module.exports = {
  buildSystemPrompt,
  carregarPrompt
};
