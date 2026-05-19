#!/usr/bin/env bash

_xacode_completions()
{
    local cur prev words cword
    _init_completion || return

    local commands="info doctor update uninstall auth ban logs task stop_task help"

    if [[ ${cword} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "${commands}" -- ${cur}) )
        return 0
    fi

    if [[ ${cword} -eq 2 && ${prev} == "auth" ]]; then
        COMPREPLY=( $(compgen -W "telegram deepseek model" -- ${cur}) )
        return 0
    fi

    if [[ ${cword} -eq 3 && ${prev} == "model" && ${words[1]} == "auth" ]]; then
        COMPREPLY=( $(compgen -W "deepseek-v4-pro deepseek-v4-flash deepseek-chat deepseek-coder" -- ${cur}) )
        return 0
    fi
}

complete -F _xacode_completions xacode
