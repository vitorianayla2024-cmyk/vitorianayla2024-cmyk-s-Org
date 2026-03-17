import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  FileUp, 
  FileText, 
  Download, 
  Loader2, 
  AlertCircle, 
  CheckCircle2,
  Table as TableIcon,
  X,
  Image as ImageIcon,
  ArrowRightLeft,
  Lock,
  Unlock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx-js-style';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { extractTransactionsFromPdf, extractTransactionsFromImage, extractTransactionsFromText, type Transaction, type LayoutType } from './services/geminiService';
import { isPdfEncrypted, extractTextFromPdfWithPassword } from './services/pdfService';
import { supabase } from './lib/supabase';
import { Database, CloudUpload } from 'lucide-react';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [mode, setMode] = useState<'EXCEL' | 'IMAGE_EXCEL'>('EXCEL');
  const [layoutType, setLayoutType] = useState<LayoutType>('COM_LEIAUTE');
  const [file, setFile] = useState<File | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dbStatus, setDbStatus] = useState<'IDLE' | 'SAVED' | 'ERROR'>('IDLE');

  const checkEncryption = async (file: File) => {
    if (file.type !== 'application/pdf') return;
    
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(file);
      const base64 = await base64Promise;
      
      // Add a timeout to encryption check to prevent hanging if worker fails
      const encrypted = await Promise.race([
        isPdfEncrypted(base64),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 5000))
      ]).catch((err) => {
        console.warn("Encryption check failed or timed out, assuming not encrypted:", err);
        return false;
      });
      
      setIsEncrypted(encrypted);
    } catch (err) {
      console.error("Error in checkEncryption:", err);
      setIsEncrypted(false);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const selectedFile = acceptedFiles[0];
      setFile(selectedFile);
      setError(null);
      setSuccess(false);
      setTransactions([]);
      setPassword('');
      setIsEncrypted(false);
      
      if (mode === 'IMAGE_EXCEL') {
        const url = URL.createObjectURL(selectedFile);
        setPreviewUrl(url);
      } else {
        setPreviewUrl(null);
        checkEncryption(selectedFile);
      }
    }
  }, [mode]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: mode === 'EXCEL' 
      ? { 'application/pdf': ['.pdf'] } 
      : { 'image/*': ['.jpg', '.jpeg', '.png'] },
    multiple: false
  });

  const processFile = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setSuccess(false);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(file);
      
      let base64 = await base64Promise;
      
      let data: Transaction[] = [];
      if (mode === 'EXCEL') {
        try {
          if (isEncrypted) {
            const extractedText = await extractTextFromPdfWithPassword(base64, password);
            data = await extractTransactionsFromText(extractedText, layoutType);
          } else {
            try {
              // Try direct PDF extraction first (multimodal)
              data = await extractTransactionsFromPdf(base64, layoutType);
            } catch (pdfErr) {
              console.warn("Direct PDF extraction failed, falling back to text extraction:", pdfErr);
              // Fallback to text extraction for non-encrypted PDFs too
              const extractedText = await extractTextFromPdfWithPassword(base64);
              data = await extractTransactionsFromText(extractedText, layoutType);
            }
          }
        } catch (err: any) {
          if (err.message === 'PDF_ENCRYPTED_OR_INVALID_PASSWORD') {
            setError('SENHA INCORRETA OU PDF PROTEGIDO. POR FAVOR, INSIRA A SENHA CORRETA.');
            setIsProcessing(false);
            return;
          }
          throw err;
        }
      } else if (mode === 'IMAGE_EXCEL') {
        data = await extractTransactionsFromImage(base64, file.type, layoutType);
      }
      
      setTransactions(data);
      if (data.length === 0) {
        setError('NENHUMA TRANSAÇÃO ENCONTRADA NO ARQUIVO. VERIFIQUE SE O ARQUIVO É UM EXTRATO VÁLIDO.');
      } else {
        setSuccess(true);
      }
    } catch (err) {
      setError('OCORREU UM ERRO AO PROCESSAR O ARQUIVO. CERTIFIQUE-SE DE QUE É UM EXTRATO VÁLIDO.');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const exportToExcel = () => {
    if (transactions.length === 0) return;

    let worksheetData: any[] = [];
    let balance = 0;

    if (layoutType === 'COM_LEIAUTE') {
      worksheetData = transactions.map(t => {
        return {
          'DATA': t.data,
          'DEBITO': '',
          'CREDITO': '',
          'VALOR': t.valor,
          'COD': '',
          'HISTORICO': t.descricao
        };
      });

      // Add Total row
      const totalValor = transactions.reduce((acc, t) => acc + t.valor, 0);
      worksheetData.push({
        'DATA': 'TOTAL',
        'DEBITO': '',
        'CREDITO': '',
        'VALOR': totalValor,
        'COD': '',
        'HISTORICO': ''
      });
    } else {
      // SEM_LEIAUTE
      worksheetData = transactions.map(t => {
        balance += t.valor;
        return {
          'DATA': t.data,
          'DESCRIÇÃO': t.descricao,
          'CREDITO': t.valor > 0 ? t.valor : '',
          'DEBITO': t.valor < 0 ? Math.abs(t.valor) : '',
          'SALDO': balance
        };
      });

      // Add Total row
      const totalCredito = transactions.reduce((acc, t) => acc + (t.valor > 0 ? t.valor : 0), 0);
      const totalDebito = transactions.reduce((acc, t) => acc + (t.valor < 0 ? Math.abs(t.valor) : 0), 0);
      const totalSaldo = totalCredito - totalDebito;

      worksheetData.push({
        'DATA': 'TOTAL',
        'DESCRIÇÃO': '',
        'CREDITO': totalCredito,
        'DEBITO': totalDebito,
        'SALDO': totalSaldo
      });
    }

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);

    // Injetar fórmulas Excel para permitir recálculo automático
    const N = transactions.length;
    if (layoutType === 'COM_LEIAUTE') {
      // Fórmula do Total na coluna VALOR (D)
      const totalCellRef = XLSX.utils.encode_cell({ r: N + 1, c: 3 });
      if (worksheet[totalCellRef]) {
        worksheet[totalCellRef].f = `SUM(D2:D${N + 1})`;
      }
    } else {
      // Fórmulas de Saldo Progressivo na coluna SALDO (E)
      for (let i = 0; i < N; i++) {
        const rowIdx = i + 1; // Row 1 é cabeçalho, então Row 2 é index 1
        const saldoCellRef = XLSX.utils.encode_cell({ r: rowIdx, c: 4 });
        if (worksheet[saldoCellRef]) {
          if (i === 0) {
            worksheet[saldoCellRef].f = `C${rowIdx + 1}-D${rowIdx + 1}`;
          } else {
            worksheet[saldoCellRef].f = `E${rowIdx}+C${rowIdx + 1}-D${rowIdx + 1}`;
          }
        }
      }
      
      // Fórmulas na linha de TOTAL
      const totalCreditoRef = XLSX.utils.encode_cell({ r: N + 1, c: 2 });
      const totalDebitoRef = XLSX.utils.encode_cell({ r: N + 1, c: 3 });
      const totalSaldoRef = XLSX.utils.encode_cell({ r: N + 1, c: 4 });
      
      if (worksheet[totalCreditoRef]) worksheet[totalCreditoRef].f = `SUM(C2:C${N + 1})`;
      if (worksheet[totalDebitoRef]) worksheet[totalDebitoRef].f = `SUM(D2:D${N + 1})`;
      if (worksheet[totalSaldoRef]) worksheet[totalSaldoRef].f = `C${N + 2}-D${N + 2}`;
    }

    // Set column widths
    if (layoutType === 'COM_LEIAUTE') {
      worksheet['!cols'] = [
        { wch: 12 }, // DATA
        { wch: 10 }, // DEBITO
        { wch: 10 }, // CREDITO
        { wch: 15 }, // VALOR
        { wch: 8 },  // COD
        { wch: 50 }  // HISTORICO
      ];
    } else {
      worksheet['!cols'] = [
        { wch: 12 }, // DATA
        { wch: 50 }, // DESCRIÇÃO
        { wch: 15 }, // CREDITO
        { wch: 15 }, // DEBITO
        { wch: 15 }  // SALDO
      ];
    }

    // Apply styles
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      if (layoutType === 'COM_LEIAUTE') {
        // VALOR column (index 3)
        const valorCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 3 })];
        if (valorCell && typeof valorCell.v === 'number') {
          valorCell.z = '#,##0.00';
          valorCell.s = { 
            alignment: { horizontal: "right" },
            font: { color: { rgb: valorCell.v < 0 ? "FF0000" : "000000" } }
          };
        }
      } else {
        // CREDITO (index 2), DEBITO (index 3), SALDO (index 4)
        [2, 3, 4].forEach(c => {
          const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: c })];
          if (cell && typeof cell.v === 'number') {
            cell.z = '#,##0.00';
            cell.s = { 
              alignment: { horizontal: "right" },
              font: { color: { rgb: (c === 3 || (c === 4 && cell.v < 0)) ? "FF0000" : "000000" } }
            };
          }
        });
      }
      
      // Highlight total row (last row)
      if (R === range.e.r) {
        const cols = layoutType === 'COM_LEIAUTE' ? ['A', 'B', 'C', 'D', 'E', 'F'] : ['A', 'B', 'C', 'D', 'E'];
        cols.forEach((col, idx) => {
          const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: idx })];
          if (cell) {
            let fontColor = "000000";
            if (layoutType === 'COM_LEIAUTE') {
              if (idx === 3 && typeof cell.v === 'number' && cell.v < 0) fontColor = "FF0000";
            } else {
              if (idx === 3) fontColor = "FF0000";
              if (idx === 4 && typeof cell.v === 'number' && cell.v < 0) fontColor = "FF0000";
            }

            cell.s = { 
              ...cell.s, 
              font: { bold: true, color: { rgb: fontColor } }, 
              fill: { fgColor: { rgb: "E5E7EB" } },
              border: {
                top: { style: "thin", color: { rgb: "000000" } }
              }
            };
          }
        });
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'EXTRATO');
    XLSX.writeFile(workbook, `EXTRATO_CONVERTIDO_${new Date().getTime()}.xlsx`);
  };

  const reset = () => {
    setFile(null);
    setTransactions([]);
    setError(null);
    setSuccess(false);
    setPreviewUrl(null);
    setPassword('');
    setIsEncrypted(false);
  };

  const toggleMode = () => {
    setMode(prev => prev === 'EXCEL' ? 'IMAGE_EXCEL' : 'EXCEL');
    reset();
  };

  const saveToSupabase = async () => {
    if (!transactions.length) return;
    setIsSaving(true);
    setDbStatus('IDLE');
    
    try {
      const { error } = await supabase
        .from('extratos')
        .insert(transactions.map(t => ({
          filename: file?.name || 'unknown',
          data: t.data,
          descricao: t.descricao,
          valor: t.valor,
          layout_type: layoutType,
          created_at: new Date().toISOString()
        })));
      
      if (error) throw error;
      setDbStatus('SAVED');
      setTimeout(() => setDbStatus('IDLE'), 3000);
    } catch (err) {
      console.error('Erro ao salvar no Supabase:', err);
      setDbStatus('ERROR');
      setError('ERRO AO SALVAR NO BANCO DE DADOS. CERTIFIQUE-SE QUE A TABELA "extratos" EXISTE NO SUPABASE.');
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate running balances for display
  const transactionsWithBalance = React.useMemo(() => {
    let balance = 0;
    return transactions.map(t => {
      balance += t.valor;
      return { ...t, saldo: balance };
    });
  }, [transactions]);

  const totals = React.useMemo(() => {
    const credito = transactions.reduce((acc, t) => acc + (t.valor > 0 ? t.valor : 0), 0);
    const debito = transactions.reduce((acc, t) => acc + (t.valor < 0 ? Math.abs(t.valor) : 0), 0);
    const saldo = credito - debito;
    return { credito, debito, saldo };
  }, [transactions]);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-emerald-100 uppercase">
      {/* Header */}
      <header className="border-b border-black/5 bg-white/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <FileText size={20} />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">
              {mode === 'EXCEL' ? 'CONVERSOR: PDF > EXCEL' : 'CONVERSOR: IMAGEM > EXCEL'}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleMode}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-full text-xs font-bold hover:bg-emerald-700 transition-all shadow-md"
            >
              <ArrowRightLeft size={14} />
              {mode === 'EXCEL' ? 'ALTERAR PARA MODO IMAGEM' : 'ALTERAR PARA MODO PDF'}
            </button>
            <div className="text-xs font-medium text-black/40 uppercase tracking-widest hidden sm:block">
              MULTIFERRAMENTA V1.6
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-[400px_1fr] gap-12 items-start">
          
          {/* Left Column: Controls */}
          <section className="space-y-8">
            <div className="space-y-2">
              <h2 className="text-3xl font-bold tracking-tight">
                {mode === 'EXCEL' ? 'CONVERSOR BANCÁRIO' : 'IMAGEM PARA EXCEL'}
              </h2>
              <p className="text-black/60 leading-relaxed">
                {mode === 'EXCEL' 
                  ? 'CARREGUE SEU EXTRATO BANCÁRIO (COM OU SEM LEIAUTE PADRÃO) E NOSSA IA IRÁ EXTRAIR OS DADOS PARA O FORMATO EXCEL.'
                  : 'CARREGUE UMA IMAGEM DE UM EXTRATO (COM OU SEM LEIAUTE PADRÃO) E NOSSA IA IRÁ EXTRAIR OS DADOS DIRETAMENTE PARA EXCEL.'}
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest">TIPO DE LEIAUTE</label>
                <div className="grid grid-cols-2 gap-2 bg-black/5 p-1 rounded-xl">
                  <button
                    onClick={() => setLayoutType('COM_LEIAUTE')}
                    className={cn(
                      "py-2 px-3 rounded-lg text-[10px] font-bold transition-all uppercase",
                      layoutType === 'COM_LEIAUTE' ? "bg-white text-emerald-600 shadow-sm" : "text-black/40 hover:text-black/60"
                    )}
                  >
                    COM LEIAUTE
                  </button>
                  <button
                    onClick={() => setLayoutType('SEM_LEIAUTE')}
                    className={cn(
                      "py-2 px-3 rounded-lg text-[10px] font-bold transition-all uppercase",
                      layoutType === 'SEM_LEIAUTE' ? "bg-white text-emerald-600 shadow-sm" : "text-black/40 hover:text-black/60"
                    )}
                  >
                    SEM LEIAUTE
                  </button>
                </div>
              </div>

              <div 
                {...getRootProps()} 
                className={cn(
                  "border-2 border-dashed rounded-2xl p-8 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 text-center",
                  isDragActive ? "border-emerald-500 bg-emerald-50" : "border-black/10 hover:border-black/20 bg-white",
                  file && "border-emerald-500/30 bg-emerald-50/30"
                )}
              >
                <input {...getInputProps()} />
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center transition-colors",
                  file ? "bg-emerald-100 text-emerald-600" : "bg-black/5 text-black/40"
                )}>
                  {file 
                    ? <CheckCircle2 size={24} /> 
                    : (mode === 'EXCEL' ? <FileUp size={24} /> : <ImageIcon size={24} />)
                  }
                </div>
                <div>
                  {file ? (
                    <div className="space-y-1">
                      <p className="font-medium text-emerald-900 truncate max-w-[250px] uppercase">{file.name}</p>
                      <p className="text-xs text-emerald-600">ARQUIVO SELECIONADO</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-medium">
                        {mode === 'EXCEL' ? 'ARRASTE O PDF AQUI' : 'ARRASTE A IMAGEM AQUI'}
                      </p>
                      <p className="text-xs text-black/40">OU CLIQUE PARA SELECIONAR</p>
                    </div>
                  )}
                </div>
              </div>

              {isEncrypted && !success && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1">
                    <Lock size={10} /> PDF PROTEGIDO POR SENHA
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="INSIRA A SENHA DO PDF"
                      className="w-full bg-white border border-black/10 rounded-xl py-3 px-4 text-xs font-bold focus:outline-none focus:border-emerald-500 transition-all uppercase"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-black/20">
                      {password ? <Unlock size={16} /> : <Lock size={16} />}
                    </div>
                  </div>
                </div>
              )}

              {file && !success && (
                <button
                  onClick={processFile}
                  disabled={isProcessing}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 uppercase"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      PROCESSANDO...
                    </>
                  ) : (
                    <>
                      <TableIcon size={20} />
                      EXTRAIR DADOS
                    </>
                  )}
                </button>
              )}

              {success && (
                <div className="space-y-3">
                  <button
                    onClick={exportToExcel}
                    className="w-full bg-black text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 hover:bg-black/90 shadow-lg shadow-black/10 uppercase"
                  >
                    <Download size={20} />
                    BAIXAR EXCEL (.XLSX)
                  </button>
                  
                  <button
                    onClick={saveToSupabase}
                    disabled={isSaving}
                    className={cn(
                      "w-full font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg uppercase",
                      dbStatus === 'SAVED' ? "bg-emerald-100 text-emerald-700" : 
                      dbStatus === 'ERROR' ? "bg-red-100 text-red-700" :
                      "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/20"
                    )}
                  >
                    {isSaving ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : dbStatus === 'SAVED' ? (
                      <CheckCircle2 size={20} />
                    ) : (
                      <Database size={20} />
                    )}
                    {isSaving ? 'SALVANDO...' : dbStatus === 'SAVED' ? 'SALVO NO BANCO!' : 'SALVAR NO SUPABASE'}
                  </button>

                  <button
                    onClick={reset}
                    className="w-full bg-white border border-black/10 text-black/60 font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 hover:bg-black/5 uppercase"
                  >
                    <X size={20} />
                    LIMPAR E NOVO
                  </button>
                </div>
              )}

              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="p-4 bg-red-50 border border-red-100 rounded-xl flex gap-3 text-red-700 text-sm"
                  >
                    <AlertCircle size={18} className="shrink-0" />
                    <p>{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="pt-8 border-t border-black/5">
              <h3 className="text-xs font-bold text-black/40 uppercase tracking-widest mb-4">COMO FUNCIONA</h3>
              <ul className="space-y-4">
                {[
                  { title: 'UPLOAD SEGURO', desc: 'SEU ARQUIVO É PROCESSADO TEMPORARIAMENTE PARA CONVERSÃO.' },
                  { title: 'IA DE PRECISÃO', desc: 'IDENTIFICAMOS DATAS, VALORES E HISTÓRICOS AUTOMATICAMENTE.' },
                  { title: 'FORMATO PRONTO', desc: 'EXPORTAÇÃO DIRETA PARA O LEIAUTE SOLICITADO.' }
                ].map((item, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="w-5 h-5 rounded-full bg-black/5 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {i + 1}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold">{item.title}</h4>
                      <p className="text-xs text-black/50 leading-relaxed">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Right Column: Preview Table or Image Preview */}
          <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
            <div className="p-6 border-b border-black/5 flex items-center justify-between bg-white/50">
              <h3 className="font-semibold flex items-center gap-2 uppercase">
                <TableIcon size={18} className="text-emerald-600" />
                VISUALIZAÇÃO DOS DADOS
              </h3>
              {transactions.length > 0 && (
                <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full uppercase">
                  {transactions.length} TRANSAÇÕES ENCONTRADAS
                </span>
              )}
            </div>

            <div className="flex-1 overflow-auto">
              {transactions.length > 0 ? (
                <div className="flex flex-col h-full">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-black/[0.02] border-b border-black/5">
                        {layoutType === 'COM_LEIAUTE' ? (
                          <>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40">DATA</th>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40">DEBITO</th>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40">CREDITO</th>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40 text-right">VALOR</th>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40">COD</th>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40">HISTORICO</th>
                          </>
                        ) : (
                          <>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40">DATA</th>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40">DESCRIÇÃO</th>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40 text-right">CREDITO</th>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40 text-right">DEBITO</th>
                            <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-black/40 text-right">SALDO</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {transactionsWithBalance.map((t, i) => (
                        <motion.tr 
                          key={i}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.005 }}
                          className="hover:bg-black/[0.01] transition-colors group"
                        >
                          {layoutType === 'COM_LEIAUTE' ? (
                            <>
                              <td className="px-6 py-4 text-sm font-medium text-black/70 uppercase whitespace-nowrap">{t.data}</td>
                              <td className="px-6 py-4 text-sm text-black/40">-</td>
                              <td className="px-6 py-4 text-sm text-black/40">-</td>
                              <td className={cn(
                                "px-6 py-4 text-sm font-mono text-right font-bold",
                                t.valor < 0 ? "text-red-600" : "text-emerald-600"
                              )}>
                                {t.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-6 py-4 text-sm text-black/40">-</td>
                              <td className="px-6 py-4 text-sm text-black/60 max-w-xs truncate group-hover:whitespace-normal group-hover:overflow-visible transition-all uppercase">
                                {t.descricao}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-6 py-4 text-sm font-medium text-black/70 uppercase whitespace-nowrap">{t.data}</td>
                              <td className="px-6 py-4 text-sm text-black/60 max-w-xs truncate group-hover:whitespace-normal group-hover:overflow-visible transition-all uppercase">
                                {t.descricao}
                              </td>
                              <td className="px-6 py-4 text-sm font-mono text-right text-emerald-600 font-bold">
                                {t.valor > 0 ? t.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                              </td>
                              <td className="px-6 py-4 text-sm font-mono text-right text-red-600 font-bold">
                                {t.valor < 0 ? Math.abs(t.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '-'}
                              </td>
                              <td className={cn(
                                "px-6 py-4 text-sm font-mono text-right font-bold",
                                t.saldo < 0 ? "text-red-700" : "text-emerald-700"
                              )}>
                                {t.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                            </>
                          )}
                        </motion.tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 bg-gray-50 border-t-2 border-black/5">
                      <tr className="font-bold">
                        <td className="px-6 py-4 text-sm uppercase">TOTAL</td>
                        {layoutType === 'COM_LEIAUTE' ? (
                          <>
                            <td className="px-6 py-4"></td>
                            <td className="px-6 py-4"></td>
                            <td className={cn(
                              "px-6 py-4 text-sm font-mono text-right",
                              totals.saldo < 0 ? "text-red-700" : "text-emerald-700"
                            )}>
                              {totals.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4"></td>
                            <td className="px-6 py-4"></td>
                          </>
                        ) : (
                          <>
                            <td className="px-6 py-4"></td>
                            <td className="px-6 py-4 text-sm font-mono text-right text-emerald-700">
                              {totals.credito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4 text-sm font-mono text-right text-red-700">
                              {totals.debito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                            <td className={cn(
                              "px-6 py-4 text-sm font-mono text-right",
                              totals.saldo < 0 ? "text-red-700" : "text-emerald-700"
                            )}>
                              {totals.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                          </>
                        )}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                mode === 'IMAGE_EXCEL' && previewUrl ? (
                  <div className="p-8 flex items-center justify-center min-h-full bg-black/5">
                    <motion.img 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      src={previewUrl} 
                      alt="PREVIEW" 
                      className="max-w-full max-h-[500px] rounded-lg shadow-2xl border-4 border-white"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4">
                    <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center text-black/20">
                      <TableIcon size={32} />
                    </div>
                    <div className="max-w-xs space-y-2">
                      <p className="font-medium text-black/40 uppercase">NENHUM DADO PARA EXIBIR</p>
                      <p className="text-xs text-black/30 leading-relaxed uppercase">
                        {mode === 'EXCEL' 
                          ? 'CARREGUE UM ARQUIVO PDF E CLIQUE EM "EXTRAIR DADOS" PARA VER A PRÉVIA AQUI.'
                          : 'CARREGUE UMA IMAGEM E CLIQUE EM "EXTRAIR DADOS" PARA VER A PRÉVIA AQUI.'}
                      </p>
                    </div>
                  </div>
                )
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-8 border-t border-black/5 text-center">
        <p className="text-xs text-black/30 uppercase">
          &copy; {new Date().getFullYear()} CONVERSOR DE EXTRATO INTELIGENTE.
        </p>
      </footer>
    </div>
  );
}
