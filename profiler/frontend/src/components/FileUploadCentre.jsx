// components/FileUploadCenter.jsx
import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Database, Sparkles, ArrowRight } from "lucide-react";
import ThreadWordmark from "./ThreadWordmark";

export default function FileUploadCenter({
  onFileSelect,
  onUpload,
  mandatoryFields = [],
  mandatoryFieldOptions = [],
  mandatoryFieldsLoading = false,
  mandatoryFieldsError = "",
  onToggleMandatoryField,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      setSelectedFile(file);
      onFileSelect(file);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];

    if (file) {
      setSelectedFile(file);
      onFileSelect(file);
    }

    e.target.value = "";
  };

  const handleUpload = () => {
    if (selectedFile) {
      onUpload();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-teal-50">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-400/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-teal-400/20 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-400/5 rounded-full blur-3xl" />
        
        {/* Grid pattern */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle, #94a3b8 1px, transparent 1px)`,
            backgroundSize: '30px 30px'
          }}
        />
      </div>

      {/* Main content */}
      <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-4xl w-full mx-auto">
          {/* Logo/Brand */}
          <div className="text-center mb-12">
            <ThreadWordmark />
            <p className="text-sm sm:text-xl text-slate-600 max-w-2xl mx-auto">
              Profile quality. Trace lineage.
            </p>
          </div>

          {/* Upload Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative rounded-3xl border-2 border-dashed transition-all duration-300
              ${isDragging 
                ? 'border-blue-500 bg-blue-50/50 scale-[1.02]' 
                : 'border-slate-300 bg-white/40 hover:border-blue-400 hover:bg-blue-50/30'
              }
              ${selectedFile ? 'bg-green-50/30 border-green-400' : ''}
            `}
          >
            <div className="p-12 sm:p-16 text-center">
              {!selectedFile ? (
                <>
                  {/* Upload Icon */}
                  <div className={`mb-6 inline-flex p-4 rounded-full transition-all duration-300 ${isDragging ? 'bg-blue-100 scale-110' : 'bg-slate-100'}`}>
                    <Upload size={48} className={`transition-all ${isDragging ? 'text-blue-600 animate-bounce' : 'text-slate-400'}`} />
                  </div>

                  {/* Upload Text */}
                  <h3 className="text-2xl font-bold text-slate-800 mb-2">
                    {isDragging ? 'Drop your file here' : 'Drag & drop your file here'}
                  </h3>
                  <p className="text-slate-500 mb-6">
                    or click to browse from your computer
                  </p>

                  {/* Browse Button */}
                  <label className="inline-flex cursor-pointer">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileSelect}
                    />
                    <span className="px-6 py-3 bg-white border-2 border-slate-200 rounded-xl text-slate-700 font-medium hover:border-blue-400 hover:bg-blue-50 transition-all">
                      Choose a file
                    </span>
                  </label>

                  {/* Supported Formats */}
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm text-slate-400">
                    <span>Supported formats:</span>
                    <div className="flex gap-3">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/60 rounded-lg">
                        <FileSpreadsheet size={14} />
                        .csv
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/60 rounded-lg">
                        <FileSpreadsheet size={14} />
                        .xlsx
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/60 rounded-lg">
                        <FileSpreadsheet size={14} />
                        .xls
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Selected File Preview */}
                  <div className="mb-6 inline-flex p-4 rounded-full bg-green-100">
                    <FileSpreadsheet size={48} className="text-green-600" />
                  </div>

                  <h3 className="text-2xl font-bold text-slate-800 mb-2">
                    File selected
                  </h3>
                  
                  <div className="bg-white/60 rounded-xl p-4 mb-6 max-w-md mx-auto">
                    <p className="font-medium text-slate-800 truncate">{selectedFile.name}</p>
                    <p className="text-sm text-slate-500 mt-1">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>

                  <div className="mx-auto mb-6 max-w-2xl rounded-xl border border-rose-100 bg-white/70 p-4 text-left">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-800">
                          Mandatory fields
                        </h4>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Selected fields are marked with * and checked for blanks.
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-rose-50 px-2 py-1 text-xs font-medium text-rose-600">
                        {mandatoryFields.length} selected
                      </span>
                    </div>

                    {mandatoryFieldsLoading && (
                      <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
                        Reading columns...
                      </p>
                    )}

                    {mandatoryFieldsError && (
                      <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
                        {mandatoryFieldsError}
                      </p>
                    )}

                    {!mandatoryFieldsLoading && !mandatoryFieldsError && mandatoryFieldOptions.length > 0 && (
                      <div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                        {mandatoryFieldOptions.map((name) => {
                          const checked = mandatoryFields.includes(name);

                          return (
                            <label
                              key={name}
                              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                                checked
                                  ? "border-rose-200 bg-rose-50 text-slate-800"
                                  : "border-slate-100 bg-white/70 text-slate-600 hover:border-slate-200"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggleMandatoryField?.(name)}
                                className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-1 focus:ring-rose-200"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {name}
                                {checked && <span className="ml-0.5 text-rose-500">*</span>}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 justify-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileSelect}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-6 py-3 bg-white border-2 border-slate-200 rounded-xl text-slate-700 font-medium hover:border-slate-300 hover:bg-slate-50 transition-all"
                    >
                      Choose different file
                    </button>
                    <button
                      onClick={handleUpload}
                      className="px-6 py-3 bg-gradient-to-r from-blue-600 to-teal-500 rounded-xl text-white font-medium hover:from-blue-700 hover:to-teal-600 transition-all shadow-lg hover:shadow-xl flex items-center gap-2"
                    >
                      Profile dataset
                      <ArrowRight size={18} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Feature Highlights */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white/40 backdrop-blur-sm rounded-2xl p-6 text-center border border-white/50 hover:shadow-lg transition-all group">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                <Sparkles size={24} className="text-white" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-2">Smart Detection</h4>
              <p className="text-sm text-slate-600">Automatically identifies blanks, duplicates, and data quality issues</p>
            </div>

            <div className="bg-white/40 backdrop-blur-sm rounded-2xl p-6 text-center border border-white/50 hover:shadow-lg transition-all group">
              <div className="w-12 h-12 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                <Database size={24} className="text-white" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-2">Column Profiling</h4>
              <p className="text-sm text-slate-600">Detailed statistics and recommendations for each column</p>
            </div>

            <div className="bg-white/40 backdrop-blur-sm rounded-2xl p-6 text-center border border-white/50 hover:shadow-lg transition-all group">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                <ArrowRight size={24} className="text-white" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-2">Interactive Visuals</h4>
              <p className="text-sm text-slate-600"> Charts and matrices to explore your data quality</p>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-12 text-center">
            <p className="text-xs text-slate-400">
              Your data stays on your device • No upload to external servers
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
